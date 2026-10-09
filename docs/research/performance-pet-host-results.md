# 桌宠宿主轮询结果（T02 watcher）

目标：`C:/AI/WhaleIsle-application-performance`，基线 `26205a89` 加本轮候选。2026-10-09。只用自有日志夹具与 Node worker 验证；没有启动、关闭或接管用户的应用与桌面。

## 采用与保留

已采用生产 worker facade：原 `createDshWatch` 继续提供默认同步 `poll/start` 与既有解析逻辑，生产 manager 使用 `pet-dsh-watch-host.js`，目录枚举、stat、读取、zstd 解压、JSON 解析、贴图读取及用量镜像写入在 `pet-dsh-watch-worker.js` 中复用原 watcher。

主进程保留 2 秒定时器和单次在途；慢 poll 不堆新任务。事件与状态保持原顺序。checkpoint 先回主进程更新配置，成功 ACK 后才继续写用量镜像；保存失败不推进已提交投影，下次 poll 重试。普通同步 callback 仍同步，不让已有 pure tests 改成假异步。

停止时同步保存最近已接收的 runtime 投影（含不足一分钟的活动时间），然后使旧消息失效并 terminate 自己的 worker；未启动 worker 快速关闭，重复 close 幂等。刚接受的 checkpoint 在收到最终 result 前也更新停止用投影，避免 dispose 把新游标回退为旧值。manager `dispose()` 返回增长扫描与 watcher 的关闭 Promise；配置切换先同步清理，不等待旧 worker 退出，但旧结果无法再写旧 manager 或发送事件。正常应用退出 await dispose 由 root 集成。

宠物隐藏时 watcher 继续观察并更新助理用量；未就绪/隐藏的 outbox 保留未读 cursor。没有减少 2 秒节拍、截断 `food.seen`、丢日志、增加另一套解析器或关闭助理。增长 worker 和其缓存/账本本批没有改动。读取工作仍然存在，不能把主线程让出解释成总 CPU 已消失。

## 同夹具前后对照

Windows / Node v24.19.0，1,000 个 session，每个压缩日志 22 个事件、8,589 字节解压内容 / 304 字节 zstd。固定同一时间基准、同一组原始文件；main save callback 按生产契约规范化 dsh。首次各一次、稳定各 3 次。原始样本见 [performance-pet-host-measurements.json](./performance-pet-host-measurements.json)。完成后只清除了已核对路径的自有夹具目录。

| 指标 | 基线同步 watcher | 候选 worker facade |
| --- | --- | --- |
| 首轮首个 timer 到达 | 369.72ms | 4.75ms |
| 稳定轮询首个 timer 到达 | 100.60–107.76ms | 0.33–0.97ms |
| 首轮总 poll 完成时间 | 368.83ms | 1,344.96ms |
| 稳定总 poll 完成时间 | 100.22–107.68ms | 83.21–93.95ms |
| 首轮及稳定已提交 used | 3,000,000 | 3,000,000 |
| 首轮后总保存次数 | 1，稳定 3 轮均不增加 | 1，稳定 3 轮均不增加 |

明确收益是读取/解码不再连续占住主线程。**首轮总完成更晚**，此候选样本包含 worker 冷启动和 off-thread 扫描；第一批事件/镜像可能因此延后，不能宣称首次响应加速。此处不是长期分布，也未归因 cold 差值各阶段。真实界面须同时评判聊天/拖窗响应和第一批宠物提示的延迟，再判断是否纳入最终交付。

基线为了可重复将 speech gate rng 固定为 0；候选 worker 保持生产 `Math.random`。因此接纳的普通 speech 数不同属于既有概率门控，不能拿计数差称为丢事件；数字 usage、cursor 和保存检查保持一致。

## 定向验证

产品完成后一次运行 `pet-dsh-watch.test.js`、`pet-dsh-watch-host.test.js`、`desktop-live2d.test.js`，71 项通过、0 失败。包括原 pure 同步行为、撕裂 zstd/plain 尾部、删除/重建日志与 outbox、分钟活动检查点、提醒/里程碑去重、用量镜像失败重试，以及：

- 真实 worker 单次在途共享、隐藏时用量继续、事件/状态顺序；
- main 配置保存失败后镜像尚未生成，第二轮提交与镜像均正确；
- stop 同步保存不足一分钟活动时间、重复关闭、在途 stop 屏蔽迟到保存/事件；
- stop 发生在新 checkpoint 已提交、最终 result 尚未接收的边界，不回退 cursor/usage；
- manager 的 renderer-ready outbox 时序、保存失败后内存回滚和重试。

这是 Node 逻辑、worker 与假窗口 manager 证据，不是完整真实桌宠/聊天 UI 验收。

## 打包与真实体验待验

worker 必须 unpack 的依赖闭包：`src/main/pet-dsh-watch-worker.js` → `pet-dsh-watch.js` → `pet-growth.js`、`pet-settings.js`。`pet-growth.js` 已有 unpack；root 补 worker/watch/settings 的 pattern。主进程 facade `pet-dsh-watch-host.js` 无需额外 unpack。

仍需同一候选的真实 Electron 与安装包确认：worker 从 ASAR unpack 路径启动；一边生成日志一边聊天、拖窗/跨屏；宠物隐藏但助理用量正常；首次大量旧日志扫描的提示延迟；关闭/配置切换后旧 worker 无残留；renderer 完成加载后重要 outbox 消息只送一次。没有这些观察，不标记 T02 用户体验完成。

回退代码调度即可，保留原日志、已提交游标、统计和投喂账本，不重置用户数据。
