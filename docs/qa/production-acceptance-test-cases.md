# 历史 QA 场景库

这里保留可复用的场景步骤和历史结果。按[维护说明](../maintenance/README.md)选择本次实际受影响的检查；开发 CI 与自动分发见[发布说明](../handbook/modules/release-process.md)。旧候选、固定核心集、全表、签署和停止规则已退役，本文件不规定发布门槛。

## 0. 使用场景库

### 0.1 选择验证环境

源码行为使用源码应用；分发树行为使用打包应用；安装、升级、快捷方式与用户数据迁移使用对应安装版本。下文保留的旧场景可能指定已安装 CI 包，应按本次问题选择真实环境并说明差异。

Windows 安装包由 [Development CI](../../.github/workflows/test.yml) 的 windows job 生成，artifact 名为 `Whale-Isle-windows-x64`。`release.yml` 分发同次成功 main CI 的原始资产，不构建安装包。源码、本机包与 CI 包的结果各自绑定实际执行的版本，不互相替代。

### 0.2 记录实际观察

在 PR 中说明版本、环境、操作和结果即可；涉及 CI 安装包时说明 run 与文件摘要。自动化启动检查只能证明其观察到的路径，不能代替安装器操作、正常用户数据或可见窗口行为。§15、§16 是历史记录，不重填、不继承其 Pass 或签字。

### 0.3 失败与数据边界

区分产品故障、测试工具错误和环境缺失；未执行不记为通过。保护用户数据、权限和密钥，造障使用获准的隔离环境。源码检查通过不能否定安装版真实故障。Bots/dshbot 已移除；功能缺席、旧受管挂载清理和用户数据保留见 [移除说明](../features/dshbot.md)。

### 0.4 历史模型网关配置示例

以下是旧验证使用的配置，不要求沿用该服务或模型。需要验证提供方配置时，在 **设置 → 模型 → 添加自定义提供方** 配置实际获准使用的路由：

| 字段 | 值 |
| --- | --- |
| Provider ID | `ayase`（小写，永久；勿随意改） |
| 显示名称 | `Ayase` |
| API 地址 | `https://ayase.cn/v1` |
| API 协议 | OpenAI Completions（`openai-completions`） |
| 模型 | `grok-4.6`（至少一条） |
| API 密钥 | **仅本机 / 安全通道**；禁止写入仓库、截图、Issue、PR、提交说明 |

密钥保存后只显示脱敏描述符。若网关拒绝 `developer` role 或 `max_completion_tokens`，按官方「配置模型」指南在桌面 `$DSH_HOME/settings.yaml`（应用数据目录下的 `dsh-home/settings.yaml`，不是官方 `~/.dsh`）对该路由补 `compat` 后重测。

多轮对话受影响时，附录 A 提供记忆、读文件、命令工具和汇总的可复用步骤；执行范围与模型消耗按当前问题选择，记录实际失败轮次。

### 0.5 可选的用例记录格式

```text
用例 ID:
结果: Pass | Fail | Blocked | N/A
实际结果:
证据: 截图路径 / 日志路径 / **CI Actions run URL** / 安装包文件名与 SHA256 / About 版本
缺陷编号:（Fail 时必填）
执行人 / 日期:
```

证据说明实际执行的源码、打包或安装环境；不把一种环境的结果写成另一种环境的通过。

### 0.6 场景导航

按影响查找 §1 安装与升级、§2 模型、§3 工作区、§4 对话、§5～§8 会话与工具、§9 外观、§10 扩展、§11 生命周期、§12 负向与远程场景。SSH 场景需要获准的隔离 fixture；§13 记录旧轮次的未覆盖范围，不定义当前验证范围。

---

## 1. 安装、升级与启动

### TC-INST-001 · 安装包校验、安装并可启动 · P0

**前置：** 干净机或已卸载旧版。对象是 Actions windows artifact，不是本机 `dist\`。

**步骤：**

1. 验证 CI 安装包时，打开对应 `test.yml` windows job 的 Actions run，下载 artifact `Whale-Isle-windows-x64`。
2. 记录 run URL、文件名、SHA256。此文件即拟发布文件。  
3. 用**该文件**默认路径安装；确认桌面与开始菜单快捷方式。  
4. 从快捷方式启动；观察启动页仪器画布（品牌名、状态章、日志）。  

**期望：** 安装无报错；启动页出现并进入官方 Web UI（或明确失败态，非白屏/闪退）。禁止用本机 `dist\` Setup 或源码冷启动过本条。

### TC-INST-002 · 单实例锁 · P0

**步骤：** 已安装应用已运行时，再点**开始菜单或桌面快捷方式**（禁止用第二份源码 `electron.exe` 顶替）。

**期望：** 不出现第二套完整主窗抢资源；焦点回到已有实例。

### TC-INST-003 · 冷启动：插件加载留在启动页 · P0

**步骤：** 冷启动**已安装**应用，观察运行时就绪后至 Web UI 露出前的状态行。禁止源码 `electron .` 顶替。

**期望：** 状态可见「正在加载插件 n/m」（或等价文案）；**不**闪到官方独立「正在加载插件」页；随后进入主界面。

### TC-INST-004 · 启动失败：重试与导出日志 · P0（造障）

**前置：** 自然失败或安全造障（坏插件 / 杀 dsh）；测完恢复。

**步骤：** 进入异常态 → 重试 → 保存/下载启动日志。

**期望：** 重试可再拉起；日志落在应用管理路径，含近期错误；非渲染进程任意路径写入。

### TC-INST-005 · 用户插件弄挂：跳过插件树 · P0（造障）

**步骤：** 启动页选择跳过用户插件 / 官方组合恢复，进入主界面。

**期望：** 可用 UI；文案表明已暂时跳过（或等价）。

### TC-INST-006 · 跳过之后：重试完整插件 · P0（造障，接 005）

**步骤：** 在主界面触发「重试完整插件」/恢复用户插件树（设置或产品入口）。

**期望：** 能再次尝试完整树；成功则插件回来，失败则仍可留在可用态并有提示。

### TC-INST-007 · 自动重启倒计时与取消 · P1（造障）

**前置：** 设置中 Harness 自动重启为开。

**步骤：** 触发可恢复失败，观察倒计时；点取消。

**期望：** 倒计时与状态文案正确；取消后不再自动拉起（直到手动重试）。

### TC-INST-008 · 版本与 Release 备注一致 · P0

**步骤：** About / 设置核对版本；对照**即将上传的** Release 草稿或说明（含禁装警告）；对照该 SHA 包内 harness 基线。

**期望：** 应用版本 = 安装包/拟用 tag；Release 禁装说明被遵守；正文 harness 基线等于 **该 CI 包** 内 pin，不得用源码树超前钉，不得写 `0.1.0-rc.7`（当前包内 pin 为 `0.1.1-rc.1` 时必须如此宣传）。

### TC-INST-009 · 覆盖升级（旧版 → 本包）· P0

**前置：** 先装上一稳定版（勿用 0.2.4/0.2.5/撤回包），保留用户配置与一会话。新包必须是本轮 CI artifact。

**步骤：** 运行该 CI Setup `/S` 覆盖安装（含**同一桌面版本** overlay）→ 从快捷方式启动 → 打开原工作区与会话。原工作区走 TC-WS-006，不得只测启动 Documents 文件夹。

**期望：** 升级无半残；能进主界面；壳层已存默认 API key 与工作区路径仍可用。会话、主题、自定义模型、MCP、技能在 `userData/dsh-home`，与升级前写在 `~/.dsh` 的数据分开，**须在桌面里重配**（明确提示或不崩即可）；市场不因依赖残缺导致一打开即 `dsh 进程结束`。

### TC-INST-010 · 卸载 · P1

**步骤：** 系统「应用和功能」卸载 → 确认快捷方式移除 → 可选查安装目录。

**期望：** 卸载完成；快捷方式消失；无托盘幽灵进程（允许短延迟）。用户数据目录是否保留按产品实际记录，不当作失败除非产品承诺清除。

### TC-INST-011 · 官方 `~/.dsh` 插件不能拖死桌面新装 · P0（造障）

**前置：** 本机已有官方 `~/.dsh/profiles/web`（或手动建一份），在其 `package.json` 的 `dsh.profile.bundles` 写入一个无法解析的第三方包名。

**步骤：**

1. 安装或冷启动本包桌面应用。  
2. 观察启动页能否进入官方 Web UI。  
3. 确认肇事 `~/.dsh` 文件仍在、桌面未改写它。  
4. 底栏终端运行官方 `dsh`（若已安装）：仍使用 `~/.dsh`，进程环境没有被桌面改成 `userData/dsh-home`。

**期望：** 桌面进主界面（或走 skip-user-plugins 后仍可用）；失败不得归因于官方 home 里那条坏 bundle。Boot 日志出现桌面 `Harness 家目录` 且路径在应用数据目录下的 `dsh-home`。冷启动应先见启动器；若桌面起不来，启动器须留下并可在插件问诊里禁用肇事包后再试。官方 `~/.dsh` 字节不变。

### TC-INST-011b · 官方 credentials.yaml 毒化不能拖死桌面 · P0（造障）

**前置：** 官方 `~/.dsh/.credentials.yaml` 写入非 string 的 `refs` 值（issue #19 形态）。桌面包为 v0.2.7+。

**步骤：**

1. 冷启动桌面应用。
2. 读 Boot 日志里的 `Harness 家目录` 与 `子进程 DSH_HOME`。
3. 确认官方 `~/.dsh/.credentials.yaml` 字节未改。
4. 底栏终端运行官方 `dsh`（若已安装）：仍使用 `~/.dsh`。

**期望：** 进入 Web UI。两行 home 都在 `%APPDATA%\Deepseek-Harness-Desktop\dsh-home`（或测试 `DSHD_HOME`）。stderr / 子进程输出不得含 `\.dsh\.credentials.yaml`。官方文件未改写。

### TC-LAUNCH-001 · 冷启动只开启动器 · P0

**前置：** 关闭「打开后自动启动桌面端」，或设置中断导入恢复 / 上次启动失败的本地 hold。

**步骤：** 完全退出后冷启动安装包。

**期望：** 先出现启动器窗，不立刻运行 `dsh web`；检查到新正式版时只在可见启动器询问。草稿 Release 不得当成现网更新。无本地 hold 且关闭自动启动时，由用户手动点击启动桌面。

### TC-LAUNCH-002 · 无更新则自动进桌面 · P0

**前置：** 当前已是 GitHub `/releases/latest` 正式版；桌面 `dsh-home/sessions` 非空或官方 `~/.dsh` 无可导入数据。

**步骤：** 冷启动。

**期望：** 本地判定后立即自动启动桌面端，更新请求未返回也不阻塞。成功就绪且「启动后退出启动器」为开则关启动器窗；迟到检查不抢焦点，结果保留到下次真正打开启动器。

### TC-LAUNCH-003 · 有更新点否仍能进桌面 · P0

**前置：** 在隔离升级环境或受控更新源提供高于当前包的版本；记录实际来源，不改公开 latest。

**步骤：** 冷启动并自动进入桌面 → 从托盘打开启动器 → 询问更新 → 选「稍后」。

**期望：** 不安装、不重复启动桌面端；当前桌面继续运行，关闭再打开启动器不重复询问同一检查结果。若自动启动失败，已显示的启动器在检查结果到达后询问。

### TC-LAUNCH-004 · 可选导入不抢占启动 · P0

**前置：** 桌面 `dsh-home/sessions` 为空；官方 `~/.dsh` 有可导入会话、附件、技能、可重装插件或 MCP（或 `~/.agents/skills` 有技能包）。

**步骤：** 开启自动启动后冷启动，再关闭自动启动重试；主动打开导入页并勾选部分会话/技能/插件/MCP（可再加技能目录）后导入。另以中断导入 journal 验证恢复阻断。

**期望：** 正常自动启动进入桌面，关闭自动启动时显示首页；可选来源不强制跳转导入，中断事务恢复仍停在导入。只拷勾选项到桌面 `dsh-home`。官方 `~/.dsh` 与 `~/.agents` 字节不变。未勾选项不出现在桌面 home。UI 不展示 MCP token。空选导入不写盘。

### TC-LAUNCH-005 · 启动失败留下启动器并可禁用插件 · P0（造障）

**前置：** 桌面 profile 有一个无法解析的用户插件。

**步骤：** 冷启动让桌面失败。

**期望：** 启动器不关，切到插件排查；可禁用该包后重新启动桌面端。通用崩溃（OOM / 端口占用 / 缺 Node）不得谎称是某个插件。

### TC-LAUNCH-006 · 托盘与文件菜单可再打开启动器 · P0

**步骤：** 桌面已就绪后关启动器。托盘与文件菜单点「打开启动器」。

**期望：** 启动器再 `show()`。桌面在跑时关启动器 ≠ 退出应用。

### TC-LAUNCH-007 · 启动器浅色/深色跟官方表，不跟壁纸种子 · P0

**前置：** Appearance 已选一套非默认壁纸家族（浅色与深色半的 `background` 都不是官方 `#FFFFFF` / `#151517`）。

**步骤：**

1. 外观切浅色，冷启动（或托盘「打开启动器」）。
2. 外观切深色，再打开启动器。

**期望：** 启动器画布是官方浅色白底 / 深色 `#151517` 近黑，侧栏与主按钮跟官方 dsh web 设置壳，不是壁纸家族色。桌面主界面仍可跟 Appearance 壁纸。启动器没有仪器画布、没有 `--boot-*`。

### TC-LAUNCH-008 · 更新下载失败留在启动器 · P0（造障）

**前置：** 隔离升级环境或受控更新源提供高于当前包的版本；仅对测试下载链路制造失败，不更改全局网络设置。

**步骤：**

1. 冷启动，等更新询问弹出（此时启动器窗必须已可见，弹框不挂在隐形窗上）。
2. 点「更新」，等下载失败（或等 15 分钟整体超时）。

**期望：** 应用**不退出也不隐身**：启动器留在首页并显示错误提示（含失败原因），`updates/` 目录无半成品安装包。点「启动桌面端」仍能正常进桌面。源码运行点「更新」成功拉起安装器后也回启动器首页提示（应用不自动退出），不留无窗进程。

### TC-INST-012 · 同版本 overlay 必须重解压 Harness · P0

**前置：** 已安装本轮 CI 包，或先装同号旧 harness 包。桌面版本号不变（例如仍为 0.2.6）时 `userData/runtime/<version>` 会复用路径。

**步骤：**

1. 在 `%APPDATA%\Deepseek-Harness-Desktop\runtime\<appVersion>\` 留下无 `.dshd-runtime.json`、或 stamp 与当前 pin 不符的完整外观 extract（或先装仍含旧 `dsh web`、不认识 `--no-open` 的包）。  
2. 用**本轮 CI Setup** `/S` 覆盖同一桌面版本（或冷启动已含 stamp 修复的本轮包）。  
3. 看启动日志与 `runtime/<version>/package.json`。  

**期望：** 无戳或戳不匹配则重新解压；启动日志**不得**出现 `unknown option '--no-open'`；解压树 / About 所述 harness 与该 SHA 包内 `vendor/harness-upstream.json` pin 一致（当前 `dsh-v0.1.7-rc.2` / npm `0.1.7-rc.2`），不得复用旧 pin 的解压树。

### TC-INST-013 · 安装包内 Node 与 CI 一致 · P0

**步骤：** 打开安装目录（默认 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\`）运行 `resources\node.exe -v`。

**期望：** 完整版本与该候选 SHA 的 `.nvmrc` 及 `release.yml` 的 `setup-node` 日志一致（当前 **24.21.0**，`node-version-file: .nvmrc`）；版本不一致则该包验收失败。Electron 内置 Node 与 Office 独立锁定的 Node 不替代这里的随包 Harness Node 核对，见 [Node 24 发布基线](../decisions/implemented/process/2026-09-29-node24-release-runtime.md)。

---

## 2. 模型与提供方

### TC-MODEL-001 · 添加自定义网关并保存脱敏 · P0

**步骤：** `Ctrl+,` → 模型 → 添加自定义提供方（§0.4）→ 保存 → 重开设置。

**期望：** 保存成功；密钥不回显明文；选择器可见 `grok-4.6`。

### TC-MODEL-002 · 获取可用模型（若入口存在）· P1

**步骤：** 自定义提供方表单中「获取可用模型」，用当前地址与密钥拉取。

**期望：** 成功则列表可选入草稿；失败有可读错误；未点保存前不落盘。

### TC-MODEL-003 · 选中模型作为新会话默认 · P0

**步骤：** 选择器选中 `ayase` / `grok-4.6` → 新建会话。

**期望：** 新会话用该模型。

### TC-MODEL-004 · 第三方思考强度 · P0

**前置：** 若适配器/模型公布推理档位；`grok-4.6` 若无档位则标 N/A 并换一支持档位的模型或记「本网关未暴露 → N/A」。

**步骤：** 在思考/推理强度控件切换至少两档（如低/高），各发一句短问。

**期望：** 控件可见时可切换；请求成功；切换不崩壳。无档位时 **N/A**（须在总表注明原因）。

### TC-MODEL-005 · 识图兜底模型 · P0

**步骤：**

1. 设置中配置「识图模型 / vision fallback」（产品文案以界面为准）。  
2. 主模型保持 `grok-4.6`（或一明确不识图的主模型）。  
3. 在对话附一张简单图片，请描述图中内容。  

**期望：** 在明确不识图的主模型下，上传图片及 `read_image` 均得到与图相关的描述，并在会话日志确认 `vision/describe` 先于主请求。后续请求复用已记录描述。原生识图主模型另测直接识图；不能用它通过代替兜底链路通过。未配置且主模型不支持时，发送前拒绝并点名模型，不崩。仅有设置入口、占位文本或“无法查看图片”回复不得判兜底通过。

### TC-MODEL-006 · 兼容性兜底（按需）· P1

**前置：** 附录对话因协议字段失败。

**步骤：** 写入必要 `compat` 后重发。

**期望：** 同密钥同地址下成功。

### TC-MODEL-007 · 无可用模型时 Composer 阻拦 · P1

**步骤：** 临时去掉有效模型选择（或空提供方）观察 Composer。

**期望：** 发送被阻拦且有说明；恢复模型后可发。测完恢复 §0.4 配置。

---

## 3. 工作区与主框

### TC-WS-001 · 选择工作区并进入四栏 · P0

**步骤：** 选中本地 Git 仓库，等待连接。

**期望：** 路径生效；会话区 + Composer；标题栏含会话/分支/Git/终端/右栏等入口。

### TC-WS-002 · 快捷键：设置 / 右栏 / 终端 · P0

**步骤：** `Ctrl+,`；`Ctrl+\`；`` Ctrl+` ``。

**期望：** 均切换生效。

### TC-WS-003 · 应用菜单跳转 · P1

**步骤：** 经应用菜单打开工作区、设置、插件市场（如 `Ctrl+Shift+M`）、重启 Harness（若有）。

**期望：** 跳到正确界面；市场进**设置内**分区而非独立 BrowserWindow。

### TC-WS-004 · 窗口控件 · P0

**步骤：** 最小化、最大化/还原、关闭（关闭行为见 §11）。

**期望：** 命中区正常；主题下可见。

### TC-WS-005 · 非 Git 目录 · P1

**步骤：** 切换到无 `.git` 目录。

**期望：** 应用可用；Git 空态或可初始化；不崩溃。

### TC-WS-006 · 打开已登记的兄弟工作区 · P0

**前置：** 启动工作区仍是默认 Documents 目录（例如 `Documents\Deepseek-Harness-Desktop`）。`%APPDATA%\Deepseek-Harness-Desktop\dsh-home\storages\workspace.json` 已登记另一路径，且该路径**不是**启动目录的子路径（例如 `C:\Ai\ChisaTerminal`）。

**步骤：** 在已安装应用里从侧栏/会话打开该登记仓库，进入四栏。

**期望：** 会话 cwd 是该兄弟仓库，不是偷偷连回 Documents。本条不过则 TC-GIT-001 / TC-GIT-003 / TC-TERM-001 / 附录 A 不得标 Pass。

---

## 4. 多轮对话与 Composer（P0 核心）

> 使用 §0.4 网关，在 **已安装 CI 包** 且已打开 TC-WS-006 工作区的会话里执行附录 A；失败从该轮复测或新会话整段重跑。不得用 `qa:appendix` 冒烟目录顶替。

### TC-CHAT-001 · 附录 A 第 1 轮：连通与验证码 · P0

**步骤：** 发送附录 A-1。

**期望：** 实质回复；含连通语义与三位数。

### TC-CHAT-002 · 附录 A 第 2 轮：记忆验证码 · P0

**步骤：** 发送附录 A-2。

**期望：** 数字与第 1 轮一致。

### TC-CHAT-003 · 附录 A 第 3 轮：读 README · P0

**步骤：** 发送附录 A-3。

**期望：** 出现读文件类工具卡；摘要与真实 README 相关；审批可完成。

### TC-CHAT-004 · 附录 A 第 4 轮：终端/命令 · P0

**步骤：** 发送附录 A-4。

**期望：** 终端/shell 工具卡；回复含真实目录信息。

### TC-CHAT-005 · 附录 A 第 5 轮：综合汇总 · P0

**步骤：** 发送附录 A-5。

**期望：** 验证码、产品一句话、目录名与前轮可核对。

### TC-CHAT-006 · Composer 官方命令边界 · P0

**步骤：**

1. `/` 打开官方命令菜单（若提供）。  
2. 输入 `$fo`：不出现桌面本地 skill 菜单。  
3. 输入 `@`：不注册桌面 path source。  

**期望：** 与产品决策一致；控制台无 `sessions without inject` 崩溃。

### TC-CHAT-007 · Files Mention 写入草稿 · P0

**步骤：** Files 对文件 Mention / 加入对话。

**期望：** 草稿为 markdown 链接或约定格式；可发送。

### TC-CHAT-008 · 文件预览「添加到对话」L 范围 · P0

**步骤：**

1. Files 打开文本文件预览。  
2. 切到 **源码**（有「渲染」按钮时不要停在渲染模式）。  
3. 在 textarea **拖选若干行**（无选区时按钮不出现）。  
4. 点预览工具条 **「添加到对话」**（英文 Add to chat）。不要找终端那句「加入对话」，也不要把树行悬停「引用到输入框」当成过条（那是 TC-CHAT-007）。

**期望：** Composer 出现带 `L` 范围的 fence/引用（产品约定格式）；无 sessions-inject 崩溃。

### TC-CHAT-009 · 编辑最近用户消息并重发 · P0

**步骤：** 改最近一条用户消息并重发。

**期望：** 新回复基于改后内容；历史展示符合官方/桌面分叉规则。

### TC-CHAT-010 · 已归档取消归档 · P1

**前置：** 已安装 CI 包（0.2.8 及以后）；在 TC-WS-006 工作区侧栏有一条可识别会话。

**步骤：**

1. 活会话行 ⋯ → **归档会话**。  
2. 确认该行从分组/平铺/搜索消失；侧栏底部出现 **已归档** 分区且含该会话。  
3. 展开 **已归档** 后点该行标题/整行：不得取消归档、不得打开。  
4. ⋯ → **取消归档**（不自动打开）；再从活列表打开续聊。  
5. 确认会话回到原 workspace 分组位置（或 Ungrouped）。

**期望：** 归档只隐藏列表，日志仍在；点行无动作；仅菜单取消归档后行恢复，可正常打开续聊。永久删除日志不在本条范围（C2 / TC-CHAT-013）。

### TC-CHAT-011 · 主模型附件图（无兜底时）· P2

**步骤：** 不配识图兜底时附图片（若主模型声称支持）。

**期望：** 支持则描述；不支持则发送前拒绝。与 TC-MODEL-005 分工：005 测兜底配置路径。

### TC-CHAT-012 · 取消进行中的生成 · P1

**步骤：** 发较长任务 → 停止/取消 → 再发一句。

**期望：** 停止生效；可续聊。

### TC-CHAT-013 · 已归档删除会话 · P1

**前置：** 已安装 CI 包（0.2.8 及以后）；在 TC-WS-006 工作区侧栏有一条可识别会话。若曾关掉「显示已归档列表」，须先在设置 → 界面设置重新打开。

**步骤：**

1. 活会话行 ⋯ → **归档会话**。
2. 展开侧栏 **已归档** → ⋯ → **删除会话**。
3. 在确认对话框确认。
4. 观察确认后瞬间：该行不得出现在工作区/未分组/平铺活列表。
5. 重载应用。

**期望：** 确认后无闪回活列表；重载后该行不在分组/已归档；会话日志目录不在；工作区文件夹仍在。关「显示已归档列表」时侧栏完全无「已归档」（删前须开开关）。

---

## 5. 会话与侧栏

### TC-SESS-001 · 新建 / 切换会话 · P1

**步骤：** 新建会话发一句 → 切回旧会话 → 再切回新会话。

**期望：** 内容独立、不串话。

### TC-SESS-002 · 会话列表浏览 · P1

**步骤：** 侧栏浏览/搜索/滚动。

**期望：** 稳定；选中正确。

### TC-SESS-003 · 重启后会话仍在 · P0

**步骤：** 至少完成附录一轮后完全退出（托盘退出）再启动。

**期望：** 历史仍在；模型配置仍可用。勿用与当前包装不兼容的旧 rc 会话库硬开。

---

## 6. 工具审批

### TC-APPROVE-001 · 批准（Allow once）· P0

**前置：** 会话为**只读**沙箱。`ask_user_question`（对话里「输入你的答案」）**不改** sandbox，答「批准」不算本条。

**步骤：**

1. 发一条会让模型对工作区 **write** 的指令。  
2. 若模型只提问，回答后仍无审批条，再明确要求写入文件。  
3. 等到出现带 `[data-approval-key]` 的审批条（按钮含 **「允许一次」** / Allow once；模型需在拒绝后带 `sandbox_permissions: "workspace-write"` 重试才会出）。  
4. 点「允许一次」。

**期望：** 允许一次后写入继续，结果入对话。默认可写会话里 workspace 内 write **不弹**允许一次，工具卡自行完成符合预设，但不得把 ask-user 当审批。

### TC-APPROVE-002 · 拒绝 · P0

**步骤：** 再触发 → 拒绝。

**期望：** 按官方安全语义中止副作用；可续聊。

### TC-APPROVE-003 · 工具卡可读 · P1

**步骤：** 观察终端类 / 通用工具卡。

**期望：** 参数与输出可读。

---

## 7. Git 标题栏

### TC-GIT-001 · 状态与分支菜单 · P0

**步骤：** 与 TC-WS-006 **同一仓库**。打开分支/Git 菜单。不得只在启动工作区里测一遍就算过。

**期望：** 显示该仓库当前分支与状态；菜单列出真实分支。授权失败不得画成「没有匹配的分支」。

### TC-GIT-002 · 切换或创建分支 · P1

**步骤：** 在 TC-WS-006 仓库切换或创建 `dshd-qa/<date>`。

**期望：** 成功；状态刷新。

### TC-GIT-003 · 暂存与提交 · P0

**步骤：** 在 TC-WS-006 仓库 Stage → 说明 → Commit（勿推受保护主支除非允许）。

**期望：** 成功；空提交等有提示。不得因 `ptyCreate requires a project cwd` 或 Git 未授权而失败。

### TC-GIT-004 · Push / Pull / 开变更请求 · P1

**前置：** 可写测试远程。

**步骤：** Pull → Push → 创建 CR/PR（若有）。

**期望：** 进度与结果明确；无远程时不崩。

### TC-GIT-005 · Diff 与工作区一致 · P1

**步骤：** 右栏 Diff 对照未提交改动。

**期望：** 内容一致。

### TC-GIT-006 · Discard / 取消暂存（若有）· P1

**步骤：** 对测试文件 Unstage 或 Discard（确认文案）。

**期望：** 行为与确认框一致；误触有确认。

### TC-GIT-007 · 非仓库 Init（若有）· P2

**步骤：** 在非 Git 目录触发 Init。

**期望：** 可初始化或明确拒绝；不崩。

---

## 8. Surfaces 与终端

### TC-SURF-001 · Files：搜索、预览、送对话 · P0

**步骤：** 打开 Files。`listDir` 未完成时不得把空树画成「此目录为空。」（应见「正在列出目录…」或保持上一棵树）。列出完成后搜索 `README` → 预览 → Mention/加入对话。

**期望：** 首次打开无空目录闪一下（真·空目录 settled 后才允许该文案）；命中 README；预览可读；Composer 有引用。

### TC-SURF-002 · Files：保存与系统打开 · P1

**步骤：** 编辑一测试文件保存；「在编辑器打开」「在文件夹中显示」「系统默认打开」（有则测）。

**期望：** 保存落盘；系统动作成功或明确失败。

### TC-SURF-003 · Files：未保存关闭确认 · P1

**步骤：** 改文件不存 → 关 tab。

**期望：** 出现丢弃/保留/保存类确认。

### TC-SURF-004 · Browser：URL 与导航 · P0

**步骤：** 打开 `https://example.com`；后退/前进/刷新（有则测）。

**期望：** 加载成功；不拖垮主窗。

### TC-SURF-005 · Browser：截图 / PiP / 录制 · P2

**步骤：** 有则各试一次。

**期望：** 成功有产物；失败有提示。

### TC-SURF-006 · Agents 面板 · P1

**步骤：** 打开 Agents。

**期望：** 空态或列表正常。

### TC-SURF-007 · Tab 关闭在标题右侧 · P0

**步骤：** 多开 surface tab，观察关闭按钮。

**期望：** 关闭在标题**右侧**。

### TC-SURF-008 · Browser：安装版 dshd mini-player · P0

**步骤：** 只使用 `release.yml` Windows artifact 安装的包（不得使用源码、`dist/` 或 `qa:packaged`）。在 Browser 依次打开两个可区分的页面（A、B），记录当前 URL、页面标题以及可后退/前进状态。点击工具栏 `dshd mini-player`，确认浮层在聊天可视区内；拖拽标题栏，再从四边和四角调整大小。打开一个会覆盖 Browser 的菜单或 PiP/遮挡路径，确认 mini-player 暂停且不留下可见的重复内容，解除后恢复同一内容。点击恢复回到 Browser surface，然后执行后退到 A、前进到 B，核对 URL、history、标题和 loading 状态。

**期望：** mini-player 显示同一 Browser 内容，位置和大小始终限制在聊天可视区；拖拽与八方向缩放可用且不遮挡主窗口操作。菜单、PiP 或遮挡期间不会出现幽灵/双重呈现，解除后可继续操作。恢复后 URL / history / 标题 / loading 状态不丢失，后退和前进仍分别回到 A、B。仅以安装包可观察的内容连续性、geometry、suspend/resume 和无额外外部窗口作为本 P0 证据；第二 BrowserView 与 mini 专用 IPC 属于自动化结构不变量，由 focused tests 覆盖。证据必须是该 CI artifact SHA + 已安装 exe。

### TC-TERM-001 · 底栏终端可用 · P0

**步骤：** 与 TC-WS-006 **同一仓库** 按 `` Ctrl+` `` → `echo dshd-qa-ok`。不得只在启动工作区测。

**期望：** 抽屉打开；无「无法启动终端」；无 `ptyCreate requires a project cwd`；输出可见。另：打包 runtime 上 `http://127.0.0.1:<port>/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm` 为 **200**。

### TC-TERM-002 · 选区送对话 · P0

**步骤：**

1. 底栏终端已有输出（TC-TERM-001）。  
2. 在 Ghostty **画布**上拖选 / 双击词 / 三击行。单击抬起会清选区；PowerShell Shift+方向键 **不会**填选区。  
3. 窗格 **右下角** 出现 **「加入对话」** 后点它。不要在 +/分屏工具条或右键菜单里找。

**期望：** Composer 出现 terminal fence；可发送。

### TC-TERM-003 · 多会话 / 分屏 · P1

**步骤：** 新建终端会话；尝试分屏（若有，注意产品上限）。

**期望：** 多会话可用；分屏不崩。

### TC-TERM-004 · 销毁与重建 · P1

**步骤：** 关会话再开。

**期望：** 可再用；无僵尸 PTY 占满。

---

## 9. 外观与壁纸图库

### TC-APP-001 · 浅色 / 深色 · P0

**步骤：** 外观切换浅/深 → 重启验证。

**期望：** 立即跟随且持久。

### TC-APP-002 · Appearance 行能力边界 · P0

**步骤：** 打开外观壁纸相关行。

**期望：** 仅挑选 / 浏览 / 裁切相关 / 毛玻璃 / 像素化；**无**源列表、JSON URL、Bing 开关堆在 Appearance。

### TC-APP-003 · 本地选择壁纸并裁切 · P0

**步骤：** Appearance「选择/挑选」本地图片 → 确认裁切（窗口比例 JPEG）。

**期望：** 壁纸生效；可再调 frost/pixelate。

### TC-APP-004 · 清除壁纸 · P1

**步骤：** 清除/移除壁纸。

**期望：** 恢复无壁纸或默认底；不残留半透明异常。

### TC-APP-005 · Browse 图库窗口 · P0

**步骤：** 点「浏览」。

**期望：** 顶部分类+搜索，下方网格；含 Bing Daily、Wallhaven、收藏。

### TC-APP-006 · 收藏与确认设壁纸 · P0

**步骤：** 收藏 → 点图 → 确认设壁纸 → 是 → 裁切。

**期望：** 生效；取消确认则不更换；收藏分类可找回。

### TC-APP-007 · 图库内源 CRUD · P1

**步骤：** 在图库窗添加/编辑/删除用户 HTTPS JSON 源。

**期望：** 只在图库窗完成；Appearance 不被倾倒配置。

### TC-APP-008 · Wallhaven 仅 SFW · P0

**步骤：** 打开 Wallhaven 分类，浏览若干页。

**期望：** 仅 SFW（产品 `purity=100`）；无 R18 入口或开关。拉目录失败时文案为「超时」或「网络失败」一类，不得把 `TypeError: fetch failed` 原样丢给用户。

### TC-APP-009 · 禁源不出现 · P1

**步骤：** 在 Appearance 与图库源管理中查找 Unsplash / Pexels / Pixabay / Timeline / R18。

**期望：** 均不作为产品源提供。

### TC-APP-010 · 毛玻璃与像素化 · P1

**步骤：** 有壁纸时调节 frost / pixelate。

**期望：** 可见变化；可恢复。

### TC-APP-011 · 主题库 · P1

**步骤：** 打开主题库；新建或复制一主题 → 应用 →（可选）导出/删除。

**期望：** 可切换生效；删除不崩；重启后仍在（若已保存）。

### TC-APP-012 · 透明主题 · P1

**步骤：** 先设背景图 → 外观「玻璃透明度」区块打开「透明主题」→ 检查侧栏 / 输入框 / 菜单 / 对话框 → 关闭开关。

**期望：** 开启后所有 chrome 表面 0% 填充，壁纸压暗 mask 移除（色彩全量透出）；玻璃滑杆置灰；终端 pane 保底 75% 实心（`TERMINAL_PANE_MIN_SOLIDITY`，轻微透出壁纸）。关闭后立即恢复玻璃滑杆值与压暗层，无残留透明异常。

### TC-APP-013 · 透明主题无壁纸惰性 · P1

**步骤：** 清掉背景图 → 打开「透明主题」→ 调玻璃滑杆。

**期望：** 开关可打开但不生效（惰性），提示「透明主题需要先设置背景图才会生效」；玻璃滑杆保持可用且立即起效；菜单 / 对话框不消失。

### TC-APP-014 · 透明主题可读性 · P1

**步骤：** 设一张高对比繁杂壁纸且毛玻璃调到 0 → 打开「透明主题」→ 检查侧栏与聊天文字 → 再手动把毛玻璃拉回 0。

**期望：** 透明生效瞬间毛玻璃自动提到 20%（一次性，不是持续钳制），文字可读；手动调回 0 后不被顶回，但提示换成低毛玻璃警告文案（建议调高毛玻璃）。关闭透明不回写毛玻璃值。

### TC-APP-015 · 背景特效流动渐变 · P1

**步骤：** 无背景图时打开外观「背景特效」行 Switch → 观察界面底 → 点齿轮打开弹窗 → 换预设方案（如晚霞）保存 → 再开弹窗改配色槽 / 速度 / 数量 / 光斑形态（试混沌或光束）后保存 → 设一张背景图 → 清除背景图 → 关闭开关。

**期望：** 开启后界面后铺缓慢流动的渐变光斑；弹窗里预览实时变化，选预设保存后配色生效且速度 / 数量 / 形态保持原值，光斑形态可独立切换（混沌 / 光束形态差异肉眼可辨）且仍只动 transform，光斑数量滑杆增减有明显个数变化；自定义编辑立即反映到预览、保存后生效、取消不落盘；设背景图后特效让位（图生效、行内提示暂停），清除后特效带方案自动回来；关闭恢复无特效底。聊天区滚动条默认看不见、悬停滑块处才显示；输入框底部无遮罩带遮挡特效。系统减弱动效下光斑静止。

---

## 10. 扩展、市场与旧版迁移

### TC-EXT-001 · 设置分区可达 · P0

**步骤：** 打开 MCP、Skills、插件、市场、用量统计。

**期望：** 各区有主操作；市场为设置内 `market` 分区。

### TC-EXT-002 · 无独立市场窗口 · P0

**步骤：** 经设置、托盘「插件市场」、快捷键打开市场。

**期望：** **不**出现独立市场 BrowserWindow；始终落在设置内。

### TC-EXT-003 · 市场浏览与刷新 · P0

**步骤：** 发现列表；刷新。

**期望：** 列表或明确空/错；刷新不崩；缺依赖时应用仍能启动（对照 0.2.6 修复意图）。

### TC-EXT-004 · 安装市场插件 · P1

**步骤：** 安装允许的小插件；观察进度与重载。

**期望：** 成功则已安装可见；失败不拖死；需 allowBuilds 时提示清晰。

### TC-EXT-005 · 卸载插件 · P1

**步骤：** 卸载刚装插件。

**期望：** 列表移除；应用可用。

### TC-EXT-006 · MCP / Skills 入口 · P1

**步骤：** 各走通到取消或完成。

**期望：** 可进入；取消无坏状态。

### TC-EXT-007 · Bots 移除与升级数据保留 · P0

**步骤：**

1. 全新安装后确认界面设置没有「机器人（Bots）」开关，侧栏没有 Bots 页签及联系人、群聊、任务、例程入口；安装资源不包含 `vendor/dshbot`，全量和「跳过用户插件」恢复启动均不传 dshbot overlay。
2. 在隔离的旧版环境预留 `dshbotEnabled: true`、`dshbotPreset: true`、受管 patch 块、桌面 overlay 与桌面 junction，并记录 catalog、记忆、例程笔记、房间 preset、会话日志及附件的文件清单和摘要。升级后旧开关不生效，旧 Bots 工作不再执行。
3. 确认只清理旧桌面受管 patch 块、overlay 文件及明确指向旧 `desktop-plugins/dshbot` 或当前安装 `vendor/dshbot` 的 profile junction。其他用户 patch、真实安装目录、pnpm 链接及旧目录内其他内容保留；前述用户数据与升级前一致。`DROPPED` 继续剥离同名 profile 装载行，市场和聊天安装通道不能恢复 dshbot。
4. 再次正常和 skip 启动，确认不重新挂载、不因 dshbot 缺席误报内置组件损坏，数据仍保留。按影响验证普通会话、插件受管 Session、Project、鲸鱼娘、IM 和既有 schedule。

**期望：** 功能、设置开关、源码快照、打包运行时与桌面挂载全部移除；迁移只清理受管装载残留，保留用户数据与通用插件能力。精确边界见[移除说明](../features/dshbot.md)，执行细节见[安装包手册](tc-ext-007-dshbot-install-smoke.md)。本段为当前验收要求，未执行的路径不记为通过；下方旧报告及汇总表中的历史结果只对应其原版本。

**2026-08-26 源码实机（不填本表 Pass）：** 云端 Linux X11 GUI 对源码 Electron 完整轮换 A/B(自动)/C 三相：未装分支 walk 全绿 → `dsh plugin add github:…#path:/vendor/dshbot`（钉到 `7972a34`）后探针翻转（Bots 页签出现、已安装列出、`dshbot-room` preset 自装）→ remove + 重启回未装分支且三处残留全净。9 个 dshbot 套件 95/95、全仓 1099/0。B 相手工建群因无 `DEEPSEEK_API_KEY` BLOCKED；Windows 安装包三相维持 BLOCKED。报告：[results/2026-08-26/tc-ext-007-dshbot.md](results/2026-08-26/tc-ext-007-dshbot.md)。

### TC-EXT-008 · 设置内用量统计 · P0

**步骤：**

1. 设置 → 「用量统计」（`usage-stats`）。
2. 看空态或已有 KPI；不要求本机已有会话 token。

**期望：** 分区存在；空态文案可见即通过（含仅空白会话）。扫描失败仍出仪表盘。启动不因预置失败而挡 `dsh web`。有用量时 KPI 整数（不到 10 万）为 P1 手测。

**2026-08-23 源码实机（不填本表 Pass）：** 隔离 `dsh web` 60821 空态「暂无统计数据」/ English「No statistics yet」；60822 有用量 KPI 输入整数、浅/深热力图空格可见且蓝阶。`boot: mode=projection`，`session_projcache` 含 `usagePanel`。截图 `docs/qa/results/2026-08-23/usage-stats-empty-zh.png`、`usage-stats-zh-light.png`、`usage-stats-zh-dark.png`。未动已装实例 `:3080`。


### TC-EXT-009 · 设置内远程双标签 · P1

**当前契约：** 按 `docs/features/remote-settings.md`，`REMOTE_FEATURE_ENABLED=true`；是否开启远程仍由用户控制。历史结果表中的停放记录不代表本候选版本通过。

**步骤：**

1. 设置 → 「远程」（`remote`）→ **网关**：连接方式为「局域网／服务器」；未设置时默认服务器，显式局域网选择保留，无宿主令牌墙；不会因进入设置自动开启远程。
2. 切到 **消息渠道**：可见 dsh-im 渠道 UI（QQ／飞书／微信等）；设置侧栏**无**独立「IM机器人」项；无 DSH-IM 大标题／口号／GitHub。
3. 侧栏手机弹窗仅开关、设备与扫码；**无**局域网／中继切换。

**期望：** 双标签存在；连接方式不进弹窗，配对不进设置。侧栏弹窗在中继已连接后才显示二维码、复制链接和刷新配对码；断连显示真实状态，不显示可用配对码。桌面内置 dsh-im 缺依赖时挡启动（不得静默无「消息渠道」）。本条不替代手机蜂窝网络的端到端验收。

---

## 11. 桌面壳：托盘、关闭、更新

### TC-DESK-001 · 关闭进托盘 · P0

**前置：** 设置关闭行为为进托盘（默认若已是则直接测）。

**步骤：** 点窗口关闭。

**期望：** 进程仍在；托盘图标在；Harness 未因关窗被误杀。

### TC-DESK-002 · 托盘菜单完整 · P0

**步骤：** 关窗进托盘。Win11 须先打开托盘溢出（「显示隐藏的图标」）再 **右键** 托盘图标，逐项：**显示窗口**、**打开启动器**、**设置**、**插件市场**、**重启 Harness**、**退出**；单击托盘图标。未展开溢出就放弃 ≠ 产品缺菜单（`tray-menu.js` 已有这些项）。

**期望：**

- 显示/单击：窗口恢复。  
- 打开启动器：再打开启动器窗。  
- 设置：打开设置。  
- 插件市场：进设置市场分区（非独立窗）。  
- 重启 Harness：可恢复到可用 UI。  
- 退出：见 TC-DESK-004。  

**人手 / Blocked：** 溢出里点不到时记 Blocked（测试缺口），写明未点到的项；不要当成缺实现。  

### TC-DESK-003 · 关闭行为：直接退出 · P0

**步骤：** 设置改为「直接退出」（或等价）→ 关窗。

**期望：** 应用退出；本地 Harness 停止；无托盘残留（允许短延迟）。测完改回进托盘（若需要继续测）。

### TC-DESK-004 · 托盘退出 · P0

**前置：** 进托盘模式。Win11 同 TC-DESK-002：先展开托盘溢出再右键。

**步骤：** 托盘「退出」。

**期望：** 进程结束。

**人手 / Blocked：** 未点到托盘退出时记 Blocked；可用 TC-DESK-003 直接退出覆盖退出路径，但不得把 003 改写成 004 Pass。

### TC-DESK-005 · 检查更新 · P1

**步骤：** About 检查更新。

**期望：** 「已是最新 / 有新版本 / 网络失败」之一明确结果。

### TC-DESK-006 · 下载并安装更新 · P1（有新版本时）

**前置：** 检查到可用安装包资源。

**步骤：** 安装更新 → 观察进度 → 按提示完成。

**期望：** 进度可见；能拉起 Setup；升级后版本号前进。无新版本时 **N/A**。无 asset 时打开 Releases 页可接受。

### TC-DESK-007 · 开机启动（若设置项存在）· P2

**步骤：** 打开 `openAtLogin` / 开机启动 → 注销或重启抽检（可改用系统启动项核对）。

**期望：** 与配置一致。界面无入口但配置存在时，记 N/A 并注明。

### TC-DESK-008 · Harness 自动重启设置 · P1

**步骤：** 设置中开关自动重启、改最大次数/延迟（有则改）→ 保存。

**期望：** 持久化；与 TC-INST-007 / TC-NEG-002 行为一致。

### TC-DESK-009 · 关于页打开运行目录 · P1

**步骤：** 设置 → 关于 →「打开运行目录」。

**期望：** 系统文件管理器打开桌面 `userData/dsh-home`（Windows：`%APPDATA%\Deepseek-Harness-Desktop\dsh-home`）。不得打开 `userData` 根、安装目录、当前工作区或官方 `~/.dsh`。

### TC-DESK-010 · 桌面宠物显示、拖拽与持久化 · P1

**前置：** Harness ready；新配置桌宠默认关闭，先通过托盘主动开启；已有明确开启配置保留。

**步骤：**

1. 确认宠物只在 Harness ready 后出现，点击一次并观察轻量反馈（Codex 皮肤播放挥手帧）。
2. 拖拽宠物到安全区域（播放行走动画），缩放窗口并执行最大化/恢复。
3. 右键宠物打开换肤菜单，切换到另一只已发现的 Codex 宠物，确认画面即时更换且 `petId` 跨重启恢复；菜单「隐藏桌面宠物」等价于托盘取消勾选。
4. 重启 Harness/应用，确认宠物位置与开启状态恢复。
5. 托盘取消「桌面宠物」，确认宠物消失且原位置 Harness 仍可点击；重新勾选后确认宠物恢复。
6. 在 boot、启动器、关闭遮罩和 Harness 重启期间确认没有宠物残影。

**期望：** 宠物仅覆盖约 80–96px 小矩形，避开标题栏；窗口变化后不出屏、不吞掉矩形外 Harness 点击；归一化位置、petId 和 enabled 跨重启恢复；关闭/恢复只影响宠物，不改变 Harness 或插件/会话数据。未完成实机路径不得填 Pass。

**Codex 宠物导入补充：** 使用 `${CODEX_HOME}/pets/<pet-id>/pet.json` 与相邻 `spritesheet.webp` 的现有 Codex 包，确认应用自动发现并显示；分别验证 v1 `1536x1872 / 8x9` 与 v2 `1536x2288 / 8x11`，并确认 manifest 缺失、绝对路径、`..` 穿越和尺寸错误会被忽略，renderer 不获得通用文件系统访问。

### TC-DESK-011 · Live2D 桌面宠物（鲸鱼娘）· P1

**前置：** Harness ready；`live2dPet.enabled` 新配置默认 false，先通过托盘主动开启；已有明确开启配置保留。

**步骤：**

1. 确认宠物为整屏透明无边框置顶窗内自绘角色：空闲呼吸/眨眼/头部微动，视线跟随鼠标。
2. 指针悬停在角色上窗口恢复交互，移开后恢复点击穿透——在宠物窗口覆盖区域的普通桌面点击不被吞。
3. 拖拽角色超过阈值后松开，确认位置持久化（`config.live2dPet.x/y`）且跨重启恢复；短位移拖拽触发抛掷物理（弹道 + 边缘反弹 + 落地）。
4. 观察对话气泡：拖拽/抛掷/摸头/点按各有专属台词池，气泡为一条连续闭合轮廓（主体 + 尾巴），头顶不足时翻到角色下方，整体不出当前显示器。
5. 右键角色打开状态卡：确认等级徽章、成长进度条、算力投喂区（无算力时 CTA 置灰）、三条养成属性条与 2×3 动作格；执行「摸头」「玩耍」后对应属性与台词反馈，重启后养成属性按离线衰减规则补算。
6. 消耗真实 token 后确认「今日消耗」增长、可投喂量出现；投喂一次观察进食动画与成长进度推进。
7. 托盘/菜单「隐藏桌面宠物」→ 宠物消失；重新开启后恢复，位置与养成状态保留。
8. 多屏拖动与拔除显示器后，持久化位置 clamp 回可见工作区。

**期望：** 窗口本身不移动（位置由渲染层绘制）；穿透态不吞桌面点击；气泡单轮廓无覆盖三角形；台词离线无网络/LLM；成长只来自真实 token 消耗（不读消息正文）；养成持久化字段限 `live2dPet.{x,y,growth,stats}`。未完成实机路径不得填 Pass。

---

## 12. 负向、远程与韧性

### TC-NEG-001 · 远程默认关闭且不监听 · P0

**步骤：** 全新配置。确认设置有「远程」、侧栏有手机图标；远程开关默认关闭，连接方式默认「服务器」。检查实际监听状态。

**期望（当前 `REMOTE_FEATURE_ENABLED=true`）：** 远程入口可用，但不自动开启远程服务。连接方式默认 `relay`，不因默认服务器而自动配对。显式保存的 `lan` 与远程开关保留。

已有用户配置不能当作全新默认值证据；服务器实机测试走 TC-REM-002，显式局域网走 TC-REM-001。历史执行表中的停放 Pass/N/A 不得继承到新安装包。

### TC-REM-001 · 打开局域网远程并出现二维码 · P0

**当前必测：** 局域网是手动选项，不再以“产品停放”标 N/A。

**步骤：** 远程模式为 **局域网** 时：侧栏底部手机图标 → 远程弹窗 → 开。

**期望：** `:3180` 监听；弹窗显示配对二维码（URL 为 `http://<LAN>:3180/#offer=`）。关闭远程后停止监听。

外出 / relay 模式 **不** 走本条（不听 3180）；落地页见 [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md) TC-MREM-101。

### TC-REM-002 · 第二客户端实机全量（本轮：手机 Web UI）· P0

**本条细则：** [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md)。旧步骤（Cookie 握手、工作区选文件、Files `@path`）已作废，不得再按旧文打 Pass。

**本轮范围：** 只签 **T1 外出 Web**（桌面为局域网时加 T2）。**T3 Android Deferred**，不进本条 Pass。

**步骤：** 按该表 **§S** 与 **§0.10 模块序**（M0→M11）在 T1 走完所有 P0。测出问题立即改、复测该模块后再往下。原子项在场景失败时拆查，不能代替 §S。

**期望：** 布局阈值过、活会话 `D = P`、Ayase `grok-4.6` 五轮、切模型/思考/权限后再聊、审批窗两边弹出并可决、切会话不串台、新工作目录上再跑五轮。不得用「抽屉非空」「发过一句」或 APK 截图过关。

**非法证据：** fake-daemon `run-qa.mjs`、外出模式下 `:3180` rehearsal、bounce 替换 daemon、未部署的公网旧 `app.js`、用 T3 顶 T1。见该表 §0.4。

### TC-REM-003 · 审批允许一次 / 拒绝 · P1

**细则：** [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md) TC-MREM-704（P0 在该表；本发版表保留 P1 编号兼容）。

**步骤：** 从手机发一条会触发审批的请求；在输入区接管条点允许一次或拒绝。

**期望：** 审批不另开整页模态；桌面 pending 同步消失。

### SSH 远程工作区验收约定

`TC-RW-*` 验收对象同样必须是 §0.1 的已安装 CI Windows artifact。涉及 SSH 的用例必须使用获准的隔离测试机和专属临时目录；任何未获准的主机都不得尝试连接。输入凭据走安全通道，日志、截图、报告不得留下密码、私钥或 token。没有测试机时记录 **NOT RUN（not PASS）**，不得记 Pass 或 N/A。

以下 SSH 生产用例当前均未执行（**NOT RUN**）。源码测试使用 fake SSH/SFTP client，不能代替这里的真实 SSH、端口转发或安装包 UI 验收。API runner 在缺少环境配置时也会输出 `NOT RUN (not PASS)`；只有带隔离 fixture 并确认清理完成，才能作为相应 API 步骤的证据。

### TC-RW-001 · SSH 开关、默认值与挂载 · P1

**步骤：** 在新安装 profile 中打开通用 → 界面设置，确认「远程工作区（SSH）」默认开启。关闭并等待 Harness 重启；打开「添加工作区」检查本机目录选择仍可用、远程入口不可用。重新打开开关并等待重启，确认设置 →「远程工作区」与远程 picker 恢复。再选择一次 skip-user-plugins 恢复启动，确认内置 remote 能力仍挂载。若可检查启动记录，确认没有把用户层 `cordis.patch.yml` 当内置 overlay 写入。

**期望：** 开关状态重启后持久；开关关闭只关闭内置 SSH 插件，不影响 Harness 与本机目录选择；完整和 skip 启动均按开关状态挂载。

### TC-RW-002 · 添加机器、保存凭据并测试连接 · P1

**前置：** 获准的隔离 SSH fixture，具备验收用账号和可清理的测试目录。

**步骤：** 设置 →「远程工作区」新增机器，保存 fixture host、port、user 与验收凭据；执行「测试连接」并把该机器设为当前。使用独立的临时机器记录测试一次错误凭据，再测试无法到达的 fixture 地址。检查密码加密选项与存储失败时的提示，不截取秘密或错误命令行；确认活动机器和数据位于桌面 `$DSH_HOME/remote-workspaces`。

**期望：** 按保存机器的 `machineId` 测试并成功连接；错误能区分认证与网络问题，不泄露凭据；设为当前的机器状态可持久化。测试结束后删除临时机器记录与凭据。

### TC-RW-003 · 远程目录 picker 与本机 picker · P1

**步骤：** 在「添加工作区」打开远程 tab，选择测试机器，使用路径导航进入 fixture 目录；新建一个测试子目录并选中。记录生成的本地镜像路径，再在本机 tab 选择一个普通临时目录。

**期望：** 远程选择收养 `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` 下的镜像为 workspace；本机 tab 继续使用页内浏览，行为不退回系统对话框。关闭 SSH 开关时 picker 仍可选本机目录。

### TC-RW-004 · 远程上下文、工具操作与审计 · P1

**前置：** 已完成 TC-RW-003；fixture 目录中只有可丢弃的测试文件。

**步骤：** 在远程镜像 workspace 新建会话，确认 cwd 是镜像路径；让模型列目录、读取 fixture 文件，再用 `rw_write_file` 写入独有的临时文件。运行一次同步，然后在设置「远程工作区」中查看最近审计记录。

**期望：** 远程上下文只出现在 cwd 位于已绑定镜像的会话；`rw_list_dir`、`rw_read_file` 与 `rw_write_file` 可作用于对应 fixture；临时远端文件出现且 audit 记录目标机器与写操作。非 fixture 目录不得读写。

### TC-RW-005 · 镜像冲突与侧栏远程文件编辑 · P1

**前置：** 已完成 TC-RW-003；运行一个会主动修改指定 fixture 文件的外部 SFTP 会话。

**步骤：** 在镜像与远端同时修改同一路径，调用 `rw_sync` 或 `rw_push`。然后在右侧「远程文件」tab 打开另一个 fixture 文件；在桌面编辑尚未保存时，从外部 SFTP 修改该文件，再点保存。

**期望：** 同步明确报告三路冲突，双方内容均保留；远程文件编辑因 mtime 变化拒绝覆盖并提示重读（409），重读后可重新编辑保存。不得用 `force=true` 把冲突记成通过。

### TC-RW-006 · 主机指纹变更与 verify 策略 · P1

**前置：** 测试 fixture 支持在两轮之间轮换 SSH host key，且其操作者授权该操作。

**步骤：** 用 `accept-new` 首次连接并信任 fixture key；停止 fixture、换 key 后重启，再连接。另建一条使用 `verify` 策略且尚无已知 key 的机器记录尝试连接。

**期望：** 已信任 key 变化后连接立即被拒绝，原 known-host 记录不被覆盖；`verify` 对未知 key 拒绝且不自动写入信任记录。

### TC-RW-007 · 本地端口转发与审计 · P1

**前置：** 已获准的 fixture 上运行一个仅供测试的 echo 服务；转发端口使用临时空闲端口。

**步骤：** 在「远程工作区」创建并启动 local forward，连接本机 `127.0.0.1:<临时端口>` 请求 echo 服务；确认转发监听地址与 fixture 目标后停止并删除该规则。查看 audit log。

**期望：** 本地转发只绑定 `127.0.0.1`，可到达授权 echo 服务；停止后端口不再监听；启动、停止或失败操作有目标机器审计记录。

### TC-RW-008 · Skip-user-plugins 恢复保留内置远程能力 · P1（造障）

**前置：** 独立 disposable profile、可恢复的已安装 CI 包和获准的隔离 SSH fixture。不得对日常 profile 造障。

**步骤：** 在该 profile 安装一个无效的用户插件以触发插件树恢复；选择 skip-user-plugins 启动后，打开内置「远程工作区」并对 fixture 执行只读连接测试。随后移除无效用户插件并重试完整启动。

**期望：** skip 模式跳过用户插件，但内置 `dsh-remote` 仍可用；恢复完整插件后连接仍可用。若无法安全隔离造障则记 Blocked 并说明原因，不得静默略过。

### TC-NEG-002 · Harness 崩溃恢复 · P0（造障）

**步骤：** 结束 dsh/harness 子进程。

**期望：** 故障页或等价恢复 UI；自动或手动可回主界面。

### TC-NEG-003 · 错误密钥 · P1

**步骤：** 改错密钥发一轮 → 改回。

**期望：** 明确上游/鉴权错误；可恢复。

### TC-NEG-004 · 离线启动 · P2

**步骤：** 断网启动 → 再联网对话。

**期望：** 本地 UI 可用；联网后可对话或明确网络错误。

### TC-NEG-005 · 配置持久化抽检 · P0

**步骤：** 改主题、壁纸、关闭行为、模型默认、工作区 → 托盘退出再启动。

**期望：** 选择仍在。

### TC-NEG-006 · 关闭遮罩 · P1

**步骤：** 直接退出路径观察关闭遮罩（若有）。

**期望：** 遮罩出现且可随 locale；不永久卡住。

---

## 13. 已知不测 / 非本包承诺（核对用）

下列**不是**本表 Pass 条件；出现相关入口若产品已明确「未交付」，记观察即可，**勿当成 P0 失败**：

| 项 | 说明 |
| --- | --- |
| GPU 终端嵌入 | 非承诺 |
| Git worktree 工作循环 | 非承诺 |
| turn-diff / review-comment pick | 非承诺 |
| npx 官方 `@deepseek-ai/dsh` | 无标题栏 Git / surfaces / 终端；本表测安装包路径 |
| Intel Mac / Linux 安装包 | 本轮 Windows 门禁外 |
| 自动化 API 级 preview automation | 非日常用户路径；P2 已覆盖可见截图/PiP/录制即可 |

---

## 14. 自动化与实际操作的边界

| 入口 | 观察范围与限制 |
| --- | --- |
| `qa:source`、`qa:composer`、`qa:appendix`、`qa:shell` | 源码应用的对应行为；不证明安装器、快捷方式或安装目录运行时正常 |
| `smoke:packaged` | unpacked 分发树的启动与脚本覆盖路径；不证明安装与升级操作 |
| `qa:packaged` | unpacked 应用的相关 UI、登记工作区、Git、PTY 和运行时行为；隔离 profile 不证明用户实际数据迁移 |
| `node scripts/verify-remote-workspace-live.cjs --require-live` | 获准 SSH fixture 上的 API 操作与清理；缺配置时为 NOT RUN，不覆盖 picker、设置和侧栏 UI |
| `npm run dist` | 本机安装包构建；包身份和操作结果绑定该文件，不能当作 CI 原始产物 |

同一缺陷应验证对应用户路径，包括实际受影响的登记兄弟工作区。报告已观察的行为和剩余问题，不以脚本成功替代未执行的操作。发布流程不读取本表，也不要求候选 JSON 或签字。

---

## 15. 执行记录总表

以下是原轮次的记录与证据约定，保留结果，不用于当前版本放行。本表当时按 **2026-09-01 CI run 33455954068 / SHA256 `F2C571D2…`（Node 22.22.2，树 `cc430e8562`）** 重写。首包 `45EEC4AA` / 本机 Node 24 pack `49BD62B5` **不得**当作本轮发版 SHA。**不得**沿用 2026-08-23/24 旧 SHA 的 Pass。

证据目录：[results/2026-08-31/EXECUTION-REPORT.md](results/2026-08-31/EXECUTION-REPORT.md)

| ID | 优先级 | 结果 | 证据种类 | 缺陷/豁免 | 执行人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-INST-001 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | LocalAppData Programs；Setup 0.2.7 `/S` overlay | Trent | 2026-09-01 |
| TC-INST-002 | P0 | Pass | CI SHA + 已装 exe | 二次 spawn 仍一条 harness URL | Trent | 2026-08-31 |
| TC-INST-003 | P0 | Pass | CI SHA + 已装 exe | 启动后仍有 boot.html + 3080 | Trent | 2026-08-31 |
| TC-INST-004 | P0 造障 | Blocked |  | 未造启动失败 | Trent | 2026-08-31 |
| TC-INST-005 | P0 造障 | Blocked |  | 未造用户插件挂死 | Trent | 2026-08-31 |
| TC-INST-006 | P0 造障 | Blocked |  | 接 005 | Trent | 2026-08-31 |
| TC-INST-007 | P1 造障 |  |  | 未造 | Trent | 2026-08-31 |
| TC-INST-008 | P0 | Pass | CI SHA + 已装 exe | About 0.2.7；pin 0.1.2-alpha.2 | Trent | 2026-08-31 |
| TC-INST-009 | P0 | N/A | CI SHA + 已装 exe | 本轮是同号 overlay，不是旧版升级 | Trent | 2026-08-31 |
| TC-INST-010 | P1 |  |  | 本轮未卸载 | Trent | 2026-08-31 |
| TC-INST-011 | P0 造障 | Blocked |  | 未造官方 ~/.dsh 坏 bundle | Trent | 2026-08-31 |
| TC-INST-011b | P0 造障 | Blocked |  | 未造 credentials 毒化 | Trent | 2026-08-31 |
| TC-INST-012 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | 同号 /S overlay；stamp 在；无 --no-open | Trent | 2026-09-01 |
| TC-INST-013 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | resources\\node.exe **v22.22.2** | Trent | 2026-09-01 |
| TC-LAUNCH-001 | P0 | Pass | CI SHA + 已装 exe | autoStart=false 时能 attach launcher | Trent | 2026-08-31 |
| TC-LAUNCH-002 | P0 | Pass | CI SHA + 已装 exe | autoStart → ready + 3080 | Trent | 2026-08-31 |
| TC-LAUNCH-003 | P0 | N/A |  | 0.2.7 已是 latest，无「有更新点否」 | Trent | 2026-08-31 |
| TC-LAUNCH-004 | P0 | N/A |  | dest sessions 非空 | Trent | 2026-08-31 |
| TC-LAUNCH-005 | P0 造障 | Blocked |  | 未造 | Trent | 2026-08-31 |
| TC-LAUNCH-006 | P0 | Pass | CI SHA + 已装 exe | 关 launcher 后 harness 在；openLauncher 再开 | Trent | 2026-08-31 |
| TC-LAUNCH-007 | P0 | Pass | CI SHA + 已装 exe | celadon 配置下官方白底 | Trent | 2026-08-31 |
| TC-LAUNCH-008 | P0 造障 | Blocked |  | 未造下载失败 | Trent | 2026-08-31 |
| TC-MODEL-001 | P0 | Pass | CI SHA + 已装 exe | live ayase 已在；walker 又存了 Dshd QA 占位提供方（可手工删） | Trent | 2026-08-31 |
| TC-MODEL-002 | P1 |  |  | 未点获取可用模型 | Trent | 2026-08-31 |
| TC-MODEL-003 | P0 | Pass | CI SHA + 已装 exe | 附录会话切到 grok-4.6 | Trent | 2026-08-31 |
| TC-MODEL-004 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `composer.thinkingSwitch` switched Low → Default | Trent | 2026-09-01 |
| TC-MODEL-005 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `models.visionPicker` | Trent | 2026-09-01 |
| TC-MODEL-006 | P1 | N/A | CI SHA + 已装 exe | 附录未因协议字段失败 | Trent | 2026-08-31 |
| TC-MODEL-007 | P1 |  |  | 未测 | Trent | 2026-08-31 |
| TC-WS-001 | P0 | Pass | CI SHA + 已装 exe | 四栏 + Git 标题栏菜单可开 | Trent | 2026-08-31 |
| TC-WS-002 | P0 | Pass | CI SHA + 已装 exe | Ctrl+, / 右栏 / 终端 | Trent | 2026-08-31 |
| TC-WS-003 | P1 |  |  | 未走应用菜单 | Trent | 2026-08-31 |
| TC-WS-004 | P0 | Pass | CI SHA + 已装 exe | 最小化/最大化/关闭可点 | Trent | 2026-08-31 |
| TC-WS-005 | P1 |  |  | 未切非 Git 目录 | Trent | 2026-08-31 |
| TC-WS-006 | P0 | Pass | CI SHA + 已装 exe | 附录 cwd `C:\\Ai\\ChisaTerminal`；packaged git/pty | Trent | 2026-08-31 |
| TC-CHAT-001 | P0 | Pass | CI SHA + 已装 exe | CDP 附录验证码 **456** | Trent | 2026-08-31 |
| TC-CHAT-002 | P0 | Pass | CI SHA + 已装 exe | 456 | Trent | 2026-08-31 |
| TC-CHAT-003 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | 附录 3 tool-card + 真实 ChisaTerminal README 摘要 | Trent | 2026-09-01 |
| TC-CHAT-004 | P0 | Pass | CI SHA + 已装 exe | `C:\\Ai\\ChisaTerminal` | Trent | 2026-08-31 |
| TC-CHAT-005 | P0 | Pass | CI SHA + 已装 exe | 456 + 目录名；产品句沿用第 3 轮误述 | Trent | 2026-08-31 |
| TC-CHAT-006 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | Lexical `[data-composer-input]`；composer official 全绿 | Trent | 2026-09-01 |
| TC-CHAT-007 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `files.mentionAppended`=`[note.md](note.md)` | Trent | 2026-09-01 |
| TC-CHAT-008 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | composer official preview.addToChat `L1 to L2` | Trent | 2026-09-01 |
| TC-CHAT-009 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `appendix.editUser` 已改写 | Trent | 2026-09-01 |
| TC-CHAT-010 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-CHAT-011 | P2 |  |  | 见 MODEL-005 | Trent | 2026-08-31 |
| TC-CHAT-012 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-CHAT-013 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-SESS-001 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-SESS-002 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-SESS-003 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | 重开后 `dsh-home/sessions` **85** 个 `session.jsonl.zstd`（packed walker 只认 `session.jsonl`，host 复核） | Trent | 2026-09-01 |
| TC-APPROVE-001 | P0 | Pass | CI SHA + 已装 exe | 附录工具轮自动点「允许一次」跑完 | Trent | 2026-08-31 |
| TC-APPROVE-002 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | 只读沙箱审批条点拒绝；`dshd-reject-probe.txt` 未写入 | Trent | 2026-09-01 |
| TC-APPROVE-003 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-GIT-001 | P0 | Pass | CI SHA + 已装 exe | 分支菜单 opened；packaged current=master | Trent | 2026-08-31 |
| TC-GIT-002 | P1 |  |  | 未切测试分支 | Trent | 2026-08-31 |
| TC-GIT-003 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `qa: commit note.md 1788227705576` | Trent | 2026-09-01 |
| TC-GIT-004 | P1 |  |  | 故意不 push | Trent | 2026-08-31 |
| TC-GIT-005 | P1 |  |  | Diff 面板 walker Pass，未人工对照 | Trent | 2026-08-31 |
| TC-GIT-006 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-GIT-007 | P2 |  |  |  | Trent | 2026-08-31 |
| TC-SURF-001 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | 搜索/README/Mention 写入草稿 | Trent | 2026-09-01 |
| TC-SURF-002 | P1 |  |  | 待装包补测 | Trent | 2026-08-31 |
| TC-SURF-003 | P1 |  |  | 待装包补测 | Trent | 2026-08-31 |
| TC-SURF-004 | P0 | Pass | CI SHA + 已装 exe | browser.url | Trent | 2026-08-31 |
| TC-SURF-005 | P2 |  |  |  | Trent | 2026-08-31 |
| TC-SURF-006 | P1 | Pass | CI SHA + 已装 exe | agents.panel / empty | Trent | 2026-08-31 |
| TC-SURF-007 | P0 | Pass | CI SHA + 已装 exe | close 在标题侧 | Trent | 2026-08-31 |
| TC-SURF-008 | P0 |  |  | 待 0.3.1 安装包补测；同一 guest / previewId；结构不变量由 focused tests 证明 | Trent | 2026-09-11 |
| TC-TERM-001 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | Ghostty wasm HTTP 200 | Trent | 2026-09-01 |
| TC-TERM-002 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | `case.terminal.addToChat` 终端 fence | Trent | 2026-09-01 |
| TC-TERM-003 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-TERM-004 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-APP-001 | P0 | Pass | CI SHA + 已装 exe | 浅色/深色切换 | Trent | 2026-08-31 |
| TC-APP-002 | P0 | Pass | CI SHA + 已装 exe | Appearance 无源列表 | Trent | 2026-08-31 |
| TC-APP-003 | P0 | Pass | CI SHA + 已装 exe | 本地 PNG 进入裁切 | Trent | 2026-08-31 |
| TC-APP-004 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-APP-005 | P0 | Pass | CI SHA + 已装 exe | 图库 dialog + Bing/Wallhaven | Trent | 2026-08-31 |
| TC-APP-006 | P0 | Pass | CI SHA + 已装 exe | Bing 确认设壁纸并裁切 | Trent | 2026-08-31 |
| TC-APP-007 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-APP-008 | P0 | Pass | CI SHA + 已装 exe | SFW chips | Trent | 2026-08-31 |
| TC-APP-009 | P1 | Pass | CI SHA + 已装 exe | 无 Unsplash 等 | Trent | 2026-08-31 |
| TC-APP-010 | P1 | Pass | CI SHA + 已装 exe | 设壁纸后毛玻璃/像素化 | Trent | 2026-08-31 |
| TC-APP-011 | P1 |  |  | 主题库本轮未单独记 | Trent | 2026-08-31 |
| TC-APP-012 | P1 |  |  | 待装包补测 | Trent | 2026-08-31 |
| TC-APP-013 | P1 |  |  | 待装包补测 | Trent | 2026-08-31 |
| TC-APP-014 | P1 |  |  | 待装包补测 | Trent | 2026-08-31 |
| TC-APP-015 | P1 |  |  | 待装包补测 | Trent | 2026-09-13 |
| TC-EXT-001 | P0 | Pass | CI SHA + 已装 exe | 设置分区可达 | Trent | 2026-08-31 |
| TC-EXT-002 | P0 | Pass | CI SHA + 已装 exe | 无第二套产品窗 | Trent | 2026-08-31 |
| TC-EXT-003 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | market.discover / installed | Trent | 2026-09-01 |
| TC-EXT-004 | P1 |  |  | 未安装市场插件 | Trent | 2026-08-31 |
| TC-EXT-005 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-EXT-006 | P1 | Pass | CI SHA + 已装 exe | MCP/技能入口 | Trent | 2026-08-31 |
| TC-EXT-007 | P1 | Pass（默认不装） | CI SHA + 已装 exe | 无 dshbot 页签；未测市场一键装 | Trent | 2026-08-31 |
| TC-EXT-008 | P0 | Pass | CI SHA + 已装 exe | usage-stats.section | Trent | 2026-08-31 |
| TC-EXT-009 | P1 | N/A |  | 产品停放 | Auto | 2026-08-31 |
| TC-DESK-001 | P0 | Pass | CI SHA + 已装 exe | closeToTray | Trent | 2026-08-31 |
| TC-DESK-002 | P0 | Pass | CI SHA + 已装 exe | 托盘五项 | Trent | 2026-08-31 |
| TC-DESK-003 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | closeWouldQuit 拦截后 tray-quit 进程 0 | Trent | 2026-09-01 |
| TC-DESK-004 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | run-installed-tray-quit 进程归零 | Trent | 2026-09-01 |
| TC-DESK-005 | P1 |  |  | 0.2.7 已是 latest | Trent | 2026-08-31 |
| TC-DESK-006 | P1 | N/A | CI SHA + 已装 exe | 无新版本 | Trent | 2026-08-31 |
| TC-DESK-007 | P2 |  |  | 未测开机启动 | Trent | 2026-08-31 |
| TC-DESK-008 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-DESK-009 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-DESK-010 | P1 |  |  | 待装包补测（Codex 皮肤 + 右键换肤） | Trent | 2026-09-15 |
| TC-DESK-011 | P1 |  |  | 待装包补测（Live2D 鲸鱼娘） | Trent | 2026-09-15 |
| TC-NEG-001 | P0 | Pass | 停放开关 | 无入口、不听 | Auto | 2026-08-31 |
| TC-REM-001 | P0 | N/A |  | 产品停放 | Auto | 2026-08-31 |
| TC-REM-002 | P0 | N/A |  | 产品停放 | Auto | 2026-08-31 |
| TC-REM-003 | P1 | N/A |  | 产品停放 | Auto | 2026-08-31 |
| TC-RW-001 | P1 |  |  | NOT RUN；待已安装 CI artifact 与生产 UI 验收 |  |  |
| TC-RW-002 | P1 |  |  | NOT RUN；需获准隔离 SSH fixture |  |  |
| TC-RW-003 | P1 |  |  | NOT RUN；需获准隔离 SSH fixture |  |  |
| TC-RW-004 | P1 |  |  | NOT RUN；需获准隔离 SSH fixture |  |  |
| TC-RW-005 | P1 |  |  | NOT RUN；需获准隔离 SSH fixture |  |  |
| TC-RW-006 | P1 |  |  | NOT RUN；需支持换 key 的获准 fixture |  |  |
| TC-RW-007 | P1 |  |  | NOT RUN；需获准隔离 SSH fixture 与 echo 服务 |  |  |
| TC-RW-008 | P1 |  |  | NOT RUN；需 disposable profile 与获准 fixture |  |  |
| TC-NEG-002 | P0 造障 | Blocked |  | 未杀 dsh 造障 | Trent | 2026-08-31 |
| TC-NEG-003 | P1 |  |  |  | Trent | 2026-08-31 |
| TC-NEG-004 | P2 |  |  |  | Trent | 2026-08-31 |
| TC-NEG-005 | P0 | Pass | CI SHA `F2C571D2` + 已装 exe | persist theme midnight / workspace ChisaTerminal / grok-4.6 Default / wallpaper / closeToTray | Trent | 2026-09-01 |
| TC-NEG-006 | P1 |  |  |  | Trent | 2026-08-31 |

---

## 16. 签字

本节保留 `0.2.7` 的历史签字，不再覆盖或继承。[历史候选记录](releases/README.md)也不作为当前发布输入；新流程不生成验收 JSON 或签字。

| 项 | 内容 |
| --- | --- |
| Actions run URL | https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33455954068 |
| Artifact 名 | `DeepSeek-Harness-windows-x64` |
| 安装包文件名 | `Deepseek-Harness-Desktop-Setup-0.2.7.exe` |
| SHA256（已测文件） | `F2C571D285B68E730FEFF5E8FB1362F48484761278D939D84E2BFD1298562856` |
| Release 将上传同一 SHA | ☑（该表对应历史 CI 文件） |
| 应用 About 版本 | `0.2.7` |
| 该包内 harness 基线（勿混源码钉） | stamp `0.1.2-alpha.2` / `dsh-v0.1.2-alpha.2` / sha `0a53fb55bea101816fa226bb964ae2bed71c343b` |
| Windows 版本 / 机型 | Windows 10.0.26200 x64 |
| 模型：`ayase` / `grok-4.6` @ `https://ayase.cn/v1` | 已配置 ☑ |
| 附录 A 五轮（安装包会话，TC-WS-006 仓） | 1–5 过 ☑；reject ☑ vision ☑ editUser ☑ |
| P0 结果 | 全 Pass □ / 有 Fail □ / 有 Blocked+负责人忽略 □ — 历史实测 P0（含 MODEL-004 / SESS-003 / TERM-002 / NEG-005）Pass；造障 INST-004/005/006/011/011b、LAUNCH-005/008、NEG-002 **Blocked**（未注入）。此行不证明后续版本 |
| P1 豁免/发布说明 | 见 [results/2026-08-31/EXECUTION-REPORT.md](results/2026-08-31/EXECUTION-REPORT.md) §7 |
| 结论 | **可交付** □ / **不可交付** □（CI Node 22 同树包已测） / **负责人忽略剩余 Blocked** □ — 测试已绑定该 SHA；产品负责人未签；未 tag / 未发 Release |
| 测试负责人 / 日期 | Trent · 2026-09-01 |
| 产品负责人 / 日期 | □ |

---

## 附录 A · 多轮对话场景步骤

验证多轮记忆和工具调用时，在同一会话按序发送；使用本次实际验证版本与相应工作区：

1. `用一句话回复：你已连通，并给出一个三位数验证码。`  
2. `刚才的验证码是多少？只回答数字。`  
3. `阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。`  
4. `在工作区执行一命令打印当前目录名，把命令输出原样贴给我。`  
5. `汇总：验证码、产品一句话、目录名各一行。`  

任一轮失败：记录轮次、工具卡截图、脱敏提供方信息（**不要**截密钥）、相关日志。

## 附录 B · 安全

- API 密钥禁止进入 git、公开截图、CI 日志。  
- 本文件只记载网关地址与模型 id。  
- 测毕可删除自定义提供方或轮换密钥。

### TC-WS-008 — Windows 原生窗口动画防复发

关联：[window-motion](../features/window-motion.md)。分别验证启动器、boot、Harness；在系统动画开启时录制最大化→还原、最小化→任务栏恢复，必须有系统过渡，恢复正常尺寸，图标与外框状态同步。浅色、深色、壁纸及透明主题下外缘保持项目 20px 圆角和透明角外像素，不缩成系统小圆角、不出现白边或角外矩形描边/填充。描边为一个物理像素，圆弧保留 alpha 抗锯齿；必须检查桌面合成后的完整四角，覆盖激活、失焦、resize、还原，页面 capturePage 不能替代。最大化时 Windows IsZoomed 必须为 true，录制由真实窗控 IPC 触发；内部 20px 内容角保留。系统禁用动画时应直接切换且操作正确，应用不得修改系统设置。覆盖多显示器/DPI 与最大化状态下最小化后恢复。

运行 `node scripts/run-window-motion-qa.mjs` 保存 HWND 样式与真实 IPC 结果；该自动检查不认证可见插值。上游同步、圆角/启动页修改和 Electron 升级均重跑。
