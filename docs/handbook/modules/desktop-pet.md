# 模块：桌面宠物（Live2D 鲸鱼娘）

桌面上的常驻伙伴：一个置顶、透明、无边框的独立窗口，里面是 DeepSeek 鲸鱼娘（THA4 神经动画模型实时驱动）。她会呼吸、眨眼、视线跟随鼠标，可以被拖拽、抛掷、摸头、逗弄；消耗的真实 token 是她的"口粮"，喂她会长等级；另有饱食/心情/亲密三条养成属性。全部离线运行，无网络请求、无 LLM 调用。

Feature card：[../../features/desktop-live2d-pet.md](../../features/desktop-live2d-pet.md)（改行为契约以卡片为准，本文是当前态详解）。

## 职责与非目标

**职责：** 桌面 overlay 角色的完整生命周期——窗口/协议/坐标、THA4 实时渲染（部件木偶为 fallback）、点击穿透交互、拖拽抛掷物理、台词气泡、状态面板、token 投喂成长、养成属性持久化。

**非目标：** 不注入 Harness DOM、不是插件、不是 BrowserView；无宠物商店/氪金/AI 对话/语音/多宠物；成长值只能来自真实 token 消耗，绝不读消息正文。

## 用户路径

| 操作 | 行为 |
| --- | --- |
| 启动后 | 默认关闭；在设置或托盘主动开启后，工作区右下角出现鲸鱼娘，空闲呼吸/眨眼/微动作，眼睛看向光标。已有明确开启的配置保留 |
| 悬停 | 窗口从点击穿透切换为可交互（可点按、可抓）；离开可见身体约 8px 后恢复穿透 |
| 点按 | 戳碰动作与表情轮换；3 秒内连戳 4 次 → 生气状态 + 喷水 |
| 拖拽 | 抓起（pick-up 悬挂状态、随速度倾斜）；松手速度慢 → 原地落下；快速甩出 → 弹道飞行、撞边反弹、地面摩擦停下；空中可再次抓住 |
| 摸头 | 在她头顶 45% 区域来回扫（1.6s 内 3 次变向）→ 摸头反应状态 + 爱心 |
| 右键 | 打开画布内绘制的状态卡（成长/投喂/属性/动作格），再点别处关闭 |
| 投喂 | 状态卡【投喂 +N】：发光晶体落下 → 她游过去 → 发现食物 → 进食 → 咀嚼 → 吃饱；升级时庆祝。当前饭碗留在地面，尚无合格的抱食姿态 |
| 睡觉 | 约 3 分 45 秒无互动先变困倦，4 分钟播放入睡过渡再沉睡（Zzz）；困倦可被互动打断，沉睡时光标碰她或点按叫醒 |
| 乱逛 | 按活跃档随机间隔自主游动（ease 插值 + 朝向镜像翻转）；瞬态位置经 `shell:live2d-roam` 同步交互热区，不写持久位置 |
| 设置 | 状态卡「⚙ 设置」→ `shell:live2d-open-settings` 跳主窗 Settings `pet` 分区：体型/不透明度、性格四档、活跃三档、自语/乱逛/锁定/SHIFT拖/省电/音效等开关、看看模型（视觉路由下拉）、鲸鱼娘助理、恢复默认（宠物窗无本地设置 UI） |
| 拖文件 | 文件拖到她身上 → 吃文件台词 + 撒花 + 少量饱食（每日限 5 次）；文件只计数不读写 |
| 隐藏 | 状态卡「隐藏」或托盘「桌面宠物」checkbox；`live2dPet.enabled=false` 持久化 |
| 多屏 | 拖拽越过屏幕边缘时 overlay 整体跳到光标所在显示器，拖拽不中断；跳屏去抖——光标须连续两次 relocate 轮询都在目标屏上才跳（快速甩出擦边不跳屏），轮询间隔 >400ms 视为新拖拽会话、计数清零 |

当前只有一张正式身份母版和 THA4 实时变形。代码登记了 24 个动作标签和 12 个表情映射，但标签含别名和未触发程序，不能视为 24 套完成的动画；其中进食和甩出仍缺可辨的手部/全身新姿态。自主害羞仅在亲密度足够时出现，低落仅在心情较低时出现。ImageGen 关键姿态的桌面尺寸审查全部未通过，留在 `docs/qa/whale-animation-review/candidates/`，正式渲染未读取。`review-live/choreography/` 中抬饭碗和空中张眼是已回退的失败试验，不能当成正式功能或验收通过的美术。审查证据见同目录 `review-screen.png` 和 `review-live/contact.png`。

审查目录的 `review-live/full-motion/` 是全部 36 段透明动态 WebP 的可播放导出（按动作取样 12–30 fps），仅供对照；正式桌宠仍实时推理，拖拽和甩动轨迹实时读取指针物理。导出逐帧检查无空帧及裁切，不能代替真正全身新姿态的美术验收。

## 架构总览

### 进程与窗口

- 主进程管理器 `src/main/desktop-live2d.js`（`LIVE2D_PET_FEATURE = true`），`app.whenReady` 后由 `src/main/index.js` 配置并 `show()`；托盘 checkbox 走同一 `setEnabled`。
- 窗口是独立 `BrowserWindow`：`transparent / frame:false / alwaysOnTop('screen-saver') / skipTaskbar / focusable:false / resizable:false`，`backgroundColor:'#00000000'`。
- **窗口永不移动**。`setPosition` 会让 Windows 分层透明窗表面变空白（拖拽闪烁/消失根因）；overlay 覆盖宠物所在的**一整块显示器**，角色只是画布内 `drawPos` 处的一帧重绘。跨屏靠整套 `setBounds` 跳到目标显示器——跳屏去抖要求光标连续两次 relocate 轮询都在目标屏上（快速甩出的擦边不跳屏），轮询间隔 >400ms 视为新拖拽会话、streak 清零。`drag-commit` 落点不在任何显示器内时 clamp 回 overlay 所在屏再持久化；渲染器对 `live2d-move` 推送一律 `clampDrawPos`。
- 混合 DPI 多屏不取虚拟屏 union——左上角落在显示器间隙死区会被 OS 静默搬迁，坐标系全乱。
- Windows/Linux 用 `setShape` 将原生窗口区域裁到各绘制源、卡片及菜单阴影；整屏只保留为绘图坐标系，透明空隙不属于窗口。交互命中逐块判断，几何变化才更新区域；显示/恢复使用 `showInactive`。macOS 继续使用穿透开关。

### `pet://` 特权协议

渲染页 `pet://pet/pet-live2d.html`。scheme 在 app ready 前注册为 `standard + secure + supportFetchAPI + stream`——WebGPU 与 onnxruntime-web 的 ES module worker 在 `file://` 下不可用。handler 只映射 `src/renderer/**`（外加共享 `dsh-webui-tokens.css`），路径穿越与不存在文件一律 404。

### 坐标系

两套空间，泾渭分明：

- **屏幕坐标**：持久化的 `live2dPet.x/y`、光标轮询、`dragCommit`，只出现在 IPC 负载里。
- **窗口（画布）坐标**：渲染器内部一切绘制/命中。`overlayOrigin`（主进程推送的窗口实际屏幕位置）做换算。不用 `event.screenX` / `window.screenX`——多 DPI 下物理像素与 DIP 混算会把角色甩出画布。

### 模块划分

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 主进程 | `src/main/desktop-live2d.js` | 窗口生命周期、`pet://` handler、IPC 授权、光标泵、位置持久化与 clamp、成长/养成接线、roam 热区、fileEat 计数 |
| 主进程 | `src/main/pet-growth.js` | 纯逻辑：会话日志 token 扫描、水位线、等级、投喂 |
| 主进程 | `src/main/pet-stats.js` | 纯逻辑：饱食/心情/亲密衰减、增量、冷却、称号 |
| 主进程 | `src/main/pet-settings.js` | 纯逻辑：设置默认值/规范化/部分合并（非法 patch 保现值不回默认）、活跃三档表、dsh 水位线与 fileEaten 归一化 |
| preload | `src/preload/index.js` | `pet-live2d` 角色的窄 API（见 IPC 一节） |
| 渲染器 | `src/renderer/pet-live2d.js` | 部件木偶渲染（主路径）、姿态控制、粒子、气泡仲裁、状态卡、乱逛 FSM、拖拽/命中；THA4 推理与立绘层为 fallback |
| 渲染器 | `src/renderer/pet-physics.js` | 纯函数物理：弹簧、出手速度估计、弹道积分与反弹（`PetPhysics` 全局） |
| 渲染器 | `src/renderer/pet-wander.js` | 纯函数乱逛：限界随机目标、面朝偏向、ease 插值滑步（`PetWander` 全局） |
| 渲染器 | `src/renderer/pet-dialogue.js` + `dialogue/whale.json` | 台词库存取、洗牌袋、人格层解析、模板渲染、时段类目 |
| 资产 | `src/renderer/pet-live2d/` | `rig/`（2048² 主图 + body/tail/六表情头部件 + manifest 锚点，主渲染路径）、`avatar/`（model.onnx + character.png，fallback）、`ort/`（onnxruntime-web，fallback）、`states/*.webp`（10 张立绘，fallback） |

## 渲染管线

### 部件木偶（part rig，ONNX 不可用时的 fallback）

- 资产全部出自同一 2048² 主视觉（待机源图 Real-ESRGAN 4×）：`rig/` 下 `body`/`tail` + 六个表情头变体（表情头取自 THA4 离线渲染的表情帧再超分），`manifest.json` 携带主图 bbox 与锚点（颈部/尾根/脚底/抓取点）。
- `drawRig` 每帧按锚点变换组装部件；`RIG_STATES` 表声明每状态运动程序（表情头选择 + 部件变换 + 全身 pivot：feet 整转 / grab 悬挂）。`stillCtl` 仍是状态持有器，alpha 兼作状态间插值权重。
- `stepPose()` 45 维 pose 数学层照跑，映射为表情头选择与头部偏移——眨眼/视线/小动作/困倦全部沿用；推理不再参与常态渲染，主循环走 60fps rAF。
- 变换纪律：部件按主图绝对坐标绘制，pivot 必须在位移项预减（回归测试覆盖：脚点锚定 drawPos，偏差即失败）。
- 决策与已知局限（举臂/蜷躯干部件待生成、右侧散发归属 body）见 `docs/decisions/archived/product/2026-09-20-pet-part-rig.md`。

### THA4 神经渲染（fallback，rig 资产缺失才启动）

- 模型：`avatar/model.onnx`，输入 `image` `[1,4,512,512]`（预乘 alpha，归一化到 [-1,1]）+ `pose` `[1,45]`，输出 512×512 RGBA。
- EP 尝试顺序 `webnn → webgpu → wasm`；WebGPU 成功时启用 `enableGraphCapture` + `preferredOutputLocation:'gpu-buffer'`，pose 经 `queue.writeBuffer` 写入常驻 GPU buffer（图捕获要求所有输入是外部 buffer）。
- WebGPU 输出先在 GPU 上将 CHW float32 转为 packed RGBA8，再下载 1MiB 的 512² 帧；钳制和半值舍入保持 `Uint8ClampedArray` 的行为。设备不能创建转换 pipeline 时沿用原 float 下载路径，WebNN/WASM 路径保持。模型、Anime4K 与推理节拍不变。
- 输出帧裁 `{x:60, y:20, w:390, h:492}` 画到 240×260；全透明帧丢弃防闪烁。
- 推理节拍到 ~20fps（50ms 一帧）——不规则的 8–15fps 读起来是闪烁，稳定慢节奏反而顺滑；立绘 alpha≥0.98 时整帧跳过推理省 GPU。（rig 模式下该节不生效——无推理，60fps rAF。）
- 每 240 个渲染帧重测一次 alpha 剪影盒 `charRect`，命中区跟着角色实际位置走，不留死角。

### 姿态控制器（45 维 pose）

`stepPose()` 在 `applyLiveState()` 之后统一按 12/13 的闭合程度减弱同侧 14–25 冲突眼形，并按双眼共同闭合程度退出 37/38 共享瞳向；待机眨眼、单眼眨眼和互动因此共用同一仲裁，另一只睁眼、眉毛与嘴部表情保留，重新睁眼后正常表情恢复。

睡眠的面部控制独占 0–38 通道：入睡逐渐退出其他表情与光标视线，熟睡仅保留 12/13 自然闭眼，避免困倦、笑眼和瞳向叠加造成眼线错位或放大；醒来后释放。头身和呼吸仍由实时模型驱动。完整动作库另有[暂缓实施方案](../../superpowers/plans/2026-09-25-whale-full-animation-library.md)，不属于当前已完成能力。

移植自 THA4 web_demo `IdlePoseGenerator`：0–11 眉、12–23 眼形、24–25 小瞳、26–36 嘴形、37–38 瞳向、39–40 头向、41 颈、42–43 身体摆动、44 呼吸。

- 空闲 = 多组不同频率/相位的正弦叠加（呼吸、体摆、头、颈、瞳）。
- 眨眼是独立状态机（0.6–1.6s 随机间隔，闭-停-开）。
- **两级视线**：瞳孔快（lerp 16/s 满幅）、头慢（5/s 且只跟一部分）——读起来是眼睛先找到光标、头再跟上。视线锚点是 THA4 头部规范点经裁剪映射，不是拍的。
- 每 5–10s 随机小动作（歪头/左右看/笑眼/蹦跳/单眨眼）+ 打哈欠；点按四表情轮换（开心/惊讶/得意/生气摇头）。

### 立绘混合层（fallback）

`states/*.webp` 十张整身立绘（pick-up / running / eat / sleep / react-head / angry / celebrate / star / greet / tail-swing），与 live 模型按 alpha 交叉淡化（7/s）。立绘占主导时命中区、气泡锚点、落地换算全部改用立绘的真实 alpha 盒。`pick-up` 是 `hang` 锚点——拎着时画在光标下方而不是 drawPos。仅当 rig 资产加载失败时接管；常态下这些状态由 `RIG_STATES` 部件程序呈现。

### 绘制节拍与清除纪律

恢复原有 `tickStill` 状态绘制、推理完成绘制与每 rAF 绘制关系，不设无人交互 60 fps 上限。推理启动间隔为 50 ms，只有用户开启省电且无交互五分钟后为 110 ms；睡眠不另设降频。Anime4K 由 HTML 静态脚本入口加载。Live 路径清理脏矩形并约每 1.5 秒全清兜底；rig fallback 每次全清，防止 Windows 分层透明窗残影。每个绘制源（角色/立绘/粒子/投喂物/气泡/面板）的清除矩形必须完全覆盖自己的墨迹，先清后画；**禁止 `shadowBlur` 或越界绘制**。DevTools 可用 `__dshdPetPerf.start()` / `.stop()` 采集内存中的推理、超分和绘制次数与 p50/p95 耗时，正常运行时不开启。

## 交互模型

### 点击穿透与双写者开关

默认 `setIgnoreMouseEvents(true, {forward:true})` 全穿透。有效交互态是**两个写者的或**：

```
interactive = rendererInteractive || cursorInPetFrame
```

- `rendererInteractive`：渲染器按真实绘制变换后的 alpha 盒命中（含 8px 退出迟滞、200ms 边缘防抖、拖拽中绝不退出）请求；清除绘制用的大方框不参与命中或气泡定位。
- `cursorInPetFrame`：主进程光标进入上报身体轮廓外扩 8px 的当拍即强制交互——渲染进程被推理占满时回路延迟可达数百 ms，等不起；光标停在该区域内时渲染器的退出请求不生效。离开该区域后渲染器标志重新说了算。
- `contextmenu` 无交互门——右键不受 flag 时序影响。

### 光标泵

穿透态下 `forward` 转发的 mousemove 在 Windows/Electron 43 实测收不到。主进程 ~30Hz（33ms）轮询 `screen.getCursorScreenPoint()`，换算成窗口坐标经 `shell:live2d-cursor` 推送；同一 key 约每秒重发一次（订阅前发出的推送会丢，停驻光标会永远失联）；光标离开 overlay 推 `{inside:false}` 兜底退出。

### 拖拽与抛掷

- pointerdown 记录抓取偏移；位移 >4px 进入拖拽（pick-up 状态 + `pickup` 台词）。拖拽中位置钉在光标上（弹簧跟随实测显 laggy，`springVelocity` 保留在物理层），速度照常采样用于甩出估计。
- 松手：`estimateReleaseVelocity` 取拖尾 0.12s 窗口——端点均速定方向、峰值段速与均速各半定幅值、末段加速增益最高 +60%、soft-knee 软上限（standard 档 4800px/s）；松手前停顿 >0.15s 视为原地放下。
- 合速度 ≥500px/s 死区 → 弹道飞行：重力 1400px/s²、屏幕边缘反弹（恢复系数 0.78）、地面摩擦 2.5/s、静止阈值 vy<40/vx<15；900ms 翻滚 + 落地 500ms 压扁回弹 + 星星。空中 pointerdown 直接抓住取消 thrown。
- 落地把悬挂状态的物理点换算回 drawPos（同一条脚底线），待机部件渲染接管，无跳变；`dragCommit` 持久化屏幕坐标。
- 跨屏：拖拽中 150ms 轮询 `shell:live2d-relocate`，光标落到别的显示器时 overlay `setBounds` 跳过去并重发 layout，渲染器按新 origin 保持同一屏幕位置。

### 睡眠与空闲

4 分钟无互动 → sleep 状态 + Zzz（1.4–2.2s 一颗），睡眠沿用当前正常或省电推理节拍。光标碰到或点按叫醒（`wake` care，心情 -7——吵醒她会闹别扭）；每分钟成长值重扫的普通快照不算互动，不能叫醒她，只有实际投喂或升级才从该推送唤醒。空闲 25–45s 随机小花招（star/celebrate/tail-swing 之一）；3–6 分钟一条闲聊气泡，受养成状态调制（见下）。

## 状态面板（右键卡）

画布内绘制的 QQ 宠物风状态卡（`PANEL_*` 常量布局），右键开合；锚在角色右侧，贴屏边翻左。打开时先拉一份新鲜 `getGrowth` 快照。结构自上而下：

- 头像裁切 + 名字 + **等级徽章**（当前级主题色填充）+ 亲密心形行；
- **成长进度条**：深色槽 + 等级色填充 + 6 个阶梯节点（已达成实色/当前环形/未来暗色）；
- **算力投喂区**：今日消耗 / 已投喂 / 【投喂 +N】CTA（无算力置灰）；
- 三条属性条：饱食 / 心情 / 亲密（低警戒红、满值绿、其余蓝）；
- 2×3 动作格：💬 聊聊 / 👀 看看 / 🫳 摸摸头 / 💤 睡觉·叫醒 / ⚙ 设置 / 🫥 隐藏。纯卖萌动作（玩耍/逗她）不进格；摸摸头走 `runAction('pat')`，与她头顶扫动触发的是同一个动作，数值收益照走 `CARE` 表。

面板开着时它的矩形并入 `petBounds()`——悬停卡片也算"在她身上"，否则卡片永远吃不到点击。十级主题色随成长变：幼鲸淡蓝 → 小鲸海蓝 → 干饭鲸青 → 鲸鱼娘靛 → 大肥鱼紫 → 干饭大王绯 → 米饭女帝朱 → 鲸吞四海琥珀 → 星海饭皇金 → 干饭真神亮金。阶梯节点在进度条上等间距排布（十级阈值跨度太大，真实比例会把前几级挤在最左端），填充=当前等级内进度。token 数字按 万/亿 简写。

## 成长系统（token 投喂）

`src/main/pet-growth.js`，纯逻辑；状态持久化在 `live2dPet.growth`。

- **口粮 = 功能启用后新增的真实 token 消耗**，历史存量不算。首次扫描种下水位线 `baseline = 语料总量 − tokensFed`（升级迁移把旧已喂额度折进去，不对新 token 计"债"）；之后水位线只跟语料**下调**（日志删了天花板就没了），`tokensFed` 永不回退。
- 可喂量 `feedable = max(0, tokensSeen − baseline) − tokensFed`；**一餐最多填满当前级**——每次投喂是一次升级仪式，不是一口吃满。
- 1 token = 1 成长点。十级称号：幼鲸(0) → 小鲸(1亿) → 干饭鲸(3亿) → 鲸鱼娘(6亿) → 大肥鱼(12亿) → 干饭大王(22亿) → 米饭女帝(40亿) → 鲸吞四海(70亿) → 星海饭皇(120亿) → 干饭真神(200亿)。
- 扫描 `dsh-home/sessions/**/session*.jsonl.zstd`：日志按事件追加 zstd 帧（单帧解码只能看到 session 头），逐帧走边界解压；同一 session 目录内 v1/v2/v3 迁移副本按 `(turn,step)` last-wins 去重，跨目录不去重；`compaction/summary` 用量单列（turn=-1）；usage 桶 = input + cacheRead + cacheWrite + output（reasoning 含在 output）。**只读数字桶，绝不读消息正文**；坏文件计 0 不炸。
- `growth.today = {day, used}`：本地日口径的当日真实消耗，供面板「今日消耗」。
- 重扫节奏：窗口起来后每 60s 一次 + `did-finish-load`/`getGrowth`/`feed` 调用时。
- 投喂表演走 feed FSM 的 `token` 变体（发光晶体替代饭碗）：落物 → 跑去 → 吃 → 收尾；升级庆祝排在进行中的动作之后，不抢戏。台词走 `feedToken/feedTokenEat/feedTokenDone/levelUp` 池。

## 养成属性（饱食/心情/亲密）

`src/main/pet-stats.js`，纯逻辑；`live2dPet.stats = {satiety, mood, affection, lastTick, care{kind→ts}}`。**惰性衰减**——读取时按 `lastTick` 折算经过的小时数，离线补算封顶 72h，未来时间戳忽略。

| 属性 | 规则 |
| --- | --- |
| 饱食 satiety | 只降：−3/h，满到空约 33h——得每天喂 |
| 心情 mood | 向 62 基线回归，±8/h 不越过基线——她懒，不亢奋 |
| 亲密 affection | 永不衰减；同类动作 10 分钟冷却，冷却期内亲密只涨 1/4（防刷） |

动作增量表（`CARE`）：feedToken(+45/+12/+5)、play(−8/+14/+3)、pat(+10/+4)、tease(+6/+2)、come(+4/+3)、throw(−9/+1)、poke(+2/+1)、wake(−7/—)。心情 <25 时逗她反噬：心情 −4、亲密 +0。

亲密五级：陌生(0) → 相识(40) → 亲近(120) → 信赖(260) → 形影不离(520)。状态对行为的调制：**satiety<20 → 闲聊大概率说饿（hungry 池）；mood<25 → 逗她炸毛（angry 状态 + grumpy 池）；affectionLevel≥4（信赖起）→ 闲聊变黏（clingy 池）**。

## 对话系统

- 台词是数据不是代码：`src/renderer/dialogue/whale.json`，`{_meta, global, agents, idleTopics, timeOfDay}`，55 类；global 池 828 条 + 三副人格各 176 条 = **1356 条全去重**（归一化后），经 `pet://` fetch。分类覆盖 greet/pickup/throw/land/pat/feed/come/tease/angry/sleep/wake/sleepy/tap0-3/feedEat/feedDone/arrive/feedToken*/levelUp/hungry/grumpy/clingy + 五个时段（latenight 23–6、morning 6–11、noon 11–14、afternoon 14–18、evening 18–23）+ 六个 idle 话题池 + 乱逛/设置/文件投喂/DSH 联动类目（wanderStart|End|Stop、personalitySet、settingsChanged、fileEat、dshWorking|Done|Error|Rest|Milestone|Miss|Approval|Question、approvalAllow|Reject、chat|lookFallback）。
- **人格层**：`global` 即软萌默认池；`agents.{genki,tsundere,poison}` 为三个副人格覆盖层。`phraseForAgent` 按 `agents[人格][类目] → global[类目]` 回退——人格池没覆盖的类目自然落到共用池；洗牌袋按 `人格:类目` 复合键独立。
- `pet-dialogue.js`：**洗牌袋**——每类一袋 Fisher-Yates 打乱、尾部弹出，一轮内不重复；重洗时若下一弹与上一轮末句相同则换到袋底，跨轮也不首尾同句。
- **气泡仲裁**：priority 0 自语 < 1 事件反应 < 2 DSH 提醒/审批。高级抢占并丢弃在显低级；同级普通气泡原地替换、带 `alertId` 的排队（队列 ≤3，溢出丢最旧）；`alertId` 匹配原地更新，`resolved` 撤销幂等；`holdBubbles(秒)`（喂食/升级演出）只挡 0 级自语。过期后从队列按优先级+先后取出，2 级提醒最少展示 4s。
- 模板引擎是参考工程 `persona_phrases.render_template` 的移植：`{field}`/`{a.b}`/`{a[0]}`/`{x!s|!r|!a}`/Python format-spec 子集；字段路径白名单（禁 `__proto__` 等根），解析失败原样保留或按 autohide 根整段消失。为 Harness 事件元数据预留，当前未接。
- 气泡与角色同 Canvas：圆角主体 + 指向尾巴是**一条连续闭合轮廓**（一次填充一次描边）；12px/16px 行高、`--dsw-alias-*` token 取色；标点悬挂换行、最大宽 150px；头顶不够翻到下方并换尾巴指向；整只气泡限定在当前显示器内。时长 `min(2200 + 90×字数, 5600)`ms，尾 300ms 淡出。
- 闲聊调度：**活跃三档**驱动随机间隔表——安静 6–12min / 均衡 2–4min / 活泼 40–80s；优先级 0，任何在显气泡/占用期/面板都让它空转下一槽（不欠账）；sleepy>0.5 时 40% 概率梦话；satiety<20 时 55% 喊饿；affectionLevel≥4 时 25% 黏人（人格 bias 微调）；否则 45% 时段类目 / 55% 随机 idle 话题。
- **乱逛调度**：同张表另一行——安静 10–20min / 均衡 5–9min / 活泼 2–4min。`pet-wander.js` 选限界随机目标（x 沿当前朝向 60–240px、70% 顺向、撞边反向；y 在上 60% 高度带内）+ ease-in-out 滑步；游动中经 `shell:live2d-roam` 报瞬态屏幕矩形给主进程交互热区；忙态（睡/拖/抛/喂/面板）即取消当前腿；朝向经 `facing` 镜像到绘制。
- **省电模式**：`powerSave` 开启且无交互 5 分钟后——推理启动间隔到 110 ms、flourish 与乱逛挂起。

## DSH 联动（pet-dsh-watch）

`src/main/pet-dsh-watch.js` 增量尾随 `dsh-home/sessions/**/*.jsonl.zstd`：按 `live2dPet.dsh.files` 字节偏移续读，只消费**完整** zstd 帧（撕裂尾帧停在原地，下轮补齐再读）。事件→状态机：`turn/start`→工作中、`turn/end`（`reason.kind==='completed'`→`dshDone`、否则 `dshError`）、`user/message`/`tool/call`/`step/start`→活跃心跳。**绝不读**消息正文/工具参数——只取类型与结构字段。

事件发出前过**概率门**：working 0.5 / done 0.9 / error·milestone·rest·miss 1.0（rng 可注入，测试用 0 全放行）。派生信号：

- **里程碑**：当日累计 token 跨 10万/50万/100万/500万/1000万 → `dshMilestone`（`milestoneMarks` 去重，跨天清零）；
- **休息劝告**：连续活跃 ≥45min 报一次，之后每小时一次；>10min 静默且无开口回合视为间断重计；
- **久别问候**：≥3 天无活动后首日见 `dshMiss`；每日首活动 `greet`。
- `{state:'working'|'idle'}` 推送驱动状态卡名牌旁的陪伴点。

水位线全持久化在 `live2dPet.dsh`（`files`/`openTurns`/`dayTokens`/`activeSince`/`lastActiveAt`/`lastSeenAt`/……），跨重启不重发。

**审批/问题提醒（R3）**：本仓 harness 无 `/api/respond` REST 端点（审批走 typert Remote 进程内协议），届时由 `dsh-whale` 插件桥接事件到 `dsh-home/data/` jsonl，本尾随器原样消费；`shell:live2d-respond` IPC 已预留。

## 快捷对话与看看屏幕（pet-chat）

- **聊聊**：面板「💬 聊聊」→ `#pet-chat` DOM 对话卡（头像+名字+关闭头部、左右分侧消息线程、自动长高 textarea + 圆形发送钮；Enter 发送 / Shift+Enter 换行 / Esc 关 / IME 组合期 Enter 不发送；仅 ✕/Esc/再点「聊聊」收起，失焦不自收）。卡每帧重锚定跟随角色——头顶优先、顶边不足翻到脚下，锚定只用身体矩形（`petBodyBounds`）避免自我反馈；卡矩形并入 `petBounds` 交互区。宠物窗平时 `focusable:false`（绝不抢键），开卡经 `shell:live2d-chat-focus` 临时 `setFocusable(true)+focus()`，关框还原 + `blur()`；Windows 上 `blur()` 可能落空（前台让给桌面时渲染层 `hasFocus` 仍报 true），若 120ms 后仍持焦则移交主窗，防 noactivate 窗静默吃键。发送链路 → `shell:live2d-chat` → `pet-chat.js`。**助理开启时走共享会话**：`pet-chat.js` 先 POST `/dsh-whale` 的 `pet/chat`（harness loopback + cookie 认证）——插件侧 `controller.prompt` 进常驻会话、`ctx.on('session/event',{global:true})` 总线等本回合 `turn/end`（`data.source.rpcId` 认领、只计自己 turn 的 assistant/message）；仅传输层够不到插件才退回 `${baseUrl}/chat/completions` 直连（凭据 `loadConfig()` 现取、人格四档 system prompt、**内存 6 轮窗口不落盘**、30s 超时、截 240 字符）。会话级失败如实返回（卡上落「这轮没跑成」错误行，不伪造影子回复）。共享模式卡片线程下方有桌面端式单枚模型入口（模型名与思考档位并列），点开独立浮层首层选择模型/思考、次级显示 provider 分组模型或中文档位（当前项勾选、限高滚动、Escape 逐层返回；浮层不改变卡片高度）（`shell:live2d-chat-state` → `pet/state`：`controller.modelCatalog()` 组表 + `modelSelection` 投影 + 共享历史尾）与 ↗ 钮（`shell:live2d-open-whale` → 主窗开同一会话）；开卡回填历史、3s 轮询增量——两边消息互通。textarea 自适应长高（≤3 行封顶，scrollbar/resize 全藏，`overflow-y:auto`+`scrollbar-width:none`）。`chatEnabled=false` 时不触网直落 `chatFallback`。
- **看看**：面板「👀 看看」→ `shell:live2d-look` → `desktopCapturer` 截宠物所在屏（≤768px JPEG70 纯内存）→ 视觉格式 `image_url` POST；视觉路由 `lookProvider`+`lookModel` 在 `pet` 分区下拉选择（候选=`session/modelCatalog` 中声明 image 输入的模型），线上请求按 `lookModel` 走桌面凭据端点（未配置→`lookFallback`）；4s 冷却。手动触发是唯一入口，无自动识屏。

## IPC 参考

preload `pet-live2d` 角色只暴露下表面（`window.shell`），主进程对每个 handler 校验 `sender === 宠物窗 webContents && frame === mainFrame && frame.url === pet://pet/pet-live2d.html`，否则抛 `ERR_DSH_LIVE2D_IPC_SENDER`。

| 方向 | channel | 负载 → 返回 |
| --- | --- | --- |
| R→M | `shell:live2d-interactive` | `{interactive:boolean}` → null（写 rendererInteractive） |
| R→M | `shell:live2d-drag-start` | → `{x,y}` 当前屏幕位置 |
| R→M | `shell:live2d-drag-move` | `{x,y}` → `[x,y]`（转发 move；畸形坐标不跳原点） |
| R→M | `shell:live2d-drag-commit` | `{x,y}` → 持久化后的 state |
| R→M | `shell:live2d-relocate` | → null（光标已跨屏则跳 overlay + 重发 layout） |
| R→M | `shell:live2d-hide` | → null（`enabled=false` 持久化并关窗） |
| R→M | `shell:live2d-growth` | → 快照 `{...growth, stats}`（带重扫） |
| R→M | `shell:live2d-feed` | `{amount?}` → 投喂结果 `{fed, leveledUp, ...}` |
| R→M | `shell:live2d-care` | `{kind}` → null（衰减+增量+持久化+推快照） |
| R→M | `shell:live2d-settings-get` | → 规范化后的 `live2dPet.settings` + `lookAvailable`（只读） |
| R→M | `shell:live2d-open-settings` | → `{ok}`（⚙ 格 → `openHarnessSettings('pet')`，主窗设置分区） |
| R→M | `shell:live2d-roam` | `{x,y,w,h}` 屏幕坐标 → null（瞬态热区，不落盘） |
| R→M | `shell:live2d-file-eat` | `{names[]}` → `{ate,count,satietyGranted,total}`（计数+日限 5 次的饱食） |
| M→R | `shell:live2d-move` | `{x,y}` 屏幕坐标 → 渲染器换 drawPos |
| M→R | `shell:live2d-layout` | `{origin, displays[], home}` 窗口坐标系下的显示器矩形 |
| M→R | `shell:live2d-cursor` | `{inside:true,x,y}` / `{inside:false}` |
| M→R | `shell:live2d-growth` | 快照推送（重扫/care/feed 后） |
| M→R | `shell:live2d-settings` | settings 推送（`shell:live2d-pet-settings` 写入后） |

设置写入不在上表——它在主窗侧：`shell:live2d-pet-settings`（HARNESS_ONLY，`{enabled?}`/`{patch}`/`{reset:true}` → 管理器 `setEnabled`/`applySettings` 规范化+持久化+推送）；`live2dPet` 不在 `save-config` 白名单上，保证写路径统一走管理器。
| R→M | `shell:live2d-chat` | `{text}` → `{ok, reply?}`（chatEnabled 关时 `{ok:false}`） |
| R→M | `shell:live2d-chat-focus` | `{focus:bool}` → null（对话卡开合时切 `setFocusable`+`focus`/`blur`） |
| R→M | `shell:live2d-chat-state` | → `{ok,enabled,sessionId?,name?,groups?,selected?,history?}`（助理关→`enabled:false`） |
| R→M | `shell:live2d-chat-select-model` | `{provider,model,reasoningEffort?}` → `{ok,selected?}`（写会话本地选择） |
| R→M | `shell:live2d-open-whale` | → `{ok}`（主窗 `sessions.open` 助理常驻会话，卡片 ↗ 钮） |
| R→M | `shell:live2d-look` | → `{ok, reply?}`（截图→视觉模型；4s 冷却/未配模型→false） |
| M→R | `shell:live2d-dsh` | `{state}` 状态推送 / `{type→category, tokens?, min?, days?}` 已门控事件 |
| M→R | `shell:live2d-alert` | `{category, alertId, summary?, buttons?, resolved?}`（R3 审批桥预留） |

## 持久化

`config.live2dPet`（`src/main/config.js` 归一化，畸形值回安全默认）：

```jsonc
{
  "enabled": false,                // 默认关闭；设置或托盘主动开启并持久化
  "x": null, "y": null,            // 屏幕坐标；null 或落不进任何显示器 → 工作区右下角
  "growth": {
    "points": 0, "tokensFed": 0, "tokensSeen": 0,
    "baseline": null,              // 水位线，首扫种下
    "today": { "day": "YYYY-MM-DD", "used": 0 }
  },
  "stats": {
    "satiety": 70, "mood": 70, "affection": 0,
    "lastTick": 0,                 // 上次衰减结算时间戳
    "care": {}                     // kind → 上次同种照顾的时间戳（冷却用）
  },
  "settings": {                    // pet-settings.js 归一化；非法 patch 保现值
    "scale": 1.0, "opacity": 1.0,  // 0.6–1.6(0.1步) / 0.3–1.0(0.05步)
    "personality": "natural",      // natural|genki|tsundere|poison
    "activity": "balanced",        // quiet|balanced|active
    "selfTalk": true, "wander": true,
    "lockPosition": false, "shiftToDrag": false,
    "powerSave": false, "clickSound": false,
    "chatEnabled": true, "approvalButtons": false
  },
  "dsh": {                         // DSH 联动水位线（尾随器游标+提醒去重）
    "day": "", "activeMsToday": 0,
    "milestoneMarks": [], "lastRestReminder": 0, "lastGreetDay": "",
    "files": {},                   // 会话日志字节偏移 → 只读追加段
    "openTurns": {},               // 开口回合 {会话:turn}（工作中判定）
    "dayTokens": {"day":"", "used":0}, // 当日 token（里程碑用）
    "activeSince": 0, "lastActiveAt": 0, "lastSeenAt": 0
  },
  "fileEaten": { "total": 0, "history": [] },  // 吃过的文件计数（history 封顶 50）
  "assistantSessionId": ""         // R3 助理会话
}
```

写盘时机：开关/拖拽提交/care 动作/投喂/重扫有变化时；`pet-dsh-watch` 每 2 秒轮询但只在日志游标、提醒或用量等持久字段变化时保存。超过配置游标上限时按规范化后的落盘投影比较，避免每轮重复保存。工作活跃时长只在内存累加，每分钟检查点一次，正常关闭时补存尾段；`usage-today.json` 只在业务快照改变时写入，原子替换失败下轮重试。崩溃最多丢失一分钟活跃时长。

## 安全边界

- contextIsolation + sandbox + 无 nodeIntegration；deny `window.open`；非 `pet://pet/pet-live2d.html` 导航一律 preventDefault。
- pet preload 只暴露上表 API——不接触 workspace/Git/文件/远程/插件面。
- 全离线：无网络请求、无 LLM、不读会话正文（growth 只吃 usage 数字）、无语音、无训练流程。

## 遗留：Codex 立绘宠物（desktop-pet，已停用）

`src/main/desktop-pet.js` + `desktop-pets.js` 是更早的形态：挂在主窗内的小矩形 `BrowserView`（88px），渲染 `${CODEX_HOME:-~/.codex}/pets/<id>/` 下 `pet.json` + WebP 图集（v1 `1536×1872 / 8×9`、v2 `1536×2288 / 8×11`，读 RIFF 头 30 字节定尺寸），右键换肤菜单，`config.pet = {enabled, xRatio, yRatio, petId}` 归一化位置。`DESKTOP_PET_FEATURE = false`——不建视图、不出托盘项，配置保留待重开。两套宠物不得同时可见；Live2D 形态归 `desktop-live2d-pet` 卡演进，本模块不动 `desktop-pet*` 文件。

## 测试与门槛

- 自动化十三件套（171 用例）：`node --test src/main/desktop-live2d.test.js src/main/desktop-pet.test.js src/main/desktop-pets.test.js src/main/dsh-whale-desktop.test.js src/main/pet-growth.test.js src/main/pet-stats.test.js src/main/pet-settings.test.js src/main/pet-dsh-watch.test.js src/main/pet-chat.test.js src/renderer/pet-live2d.test.js src/renderer/pet-dialogue.test.js src/renderer/pet-physics.test.js src/renderer/pet-wander.test.js`（物理层有 golden fixture；watch 用真 zstd 帧造 fixture）。
- 实机验收：置顶透明窗、悬停交互/离开穿透、拖拽持久化重启恢复、右键开卡、投喂/升级、多屏拖越、眨眼与视线跟随、⚙ 跳主窗 `pet` 分区且改动即时生效、乱逛热区跟随、拖文件、省电降帧、点击音效。

## 延伸阅读

- Feature card：[desktop-live2d-pet](../../features/desktop-live2d-pet.md) / [desktop-pet](../../features/desktop-pet.md)
- 设计语言宠物节：[../../design-language.md#桌面宠物](../../design-language.md#桌面宠物)
- 集成计划：[../../superpowers/plans/2026-09-14-pet-indesktop-integration.md](../../superpowers/plans/2026-09-14-pet-indesktop-integration.md)
- 模型管线：`C:\Ai\tha4`（Talking Head Anime 4 蒸馏 → ONNX RGBA）
