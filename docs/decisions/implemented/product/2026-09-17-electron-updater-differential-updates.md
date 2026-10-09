# Decision: 最新版更新接入 electron-updater 差量通道

Status: implemented

2026-10-09 调整：更新确认改为用户选择「增量更新」或「完全下载」；差量失败不再自动转整包，缓存或元数据不足时说明不可用原因。下文记录最初方案；当前行为与完整校验、任务保护约定见[托盘、关闭与更新](../../../handbook/modules/tray-update.md)。

中文 | [English](2026-09-17-electron-updater-differential-updates.en.md)

## Problem

桌面端每次升级都要经 `downloadFile` 全量下载约 636 MB 的 NSIS Setup——即便相邻版本间绝大多数分块未变。electron-builder 打包时本就生成 `.exe.blockmap` 分块清单且已随 Release 资产上传，但没有任何客户端消费它；用户端体验上「改一行代码也要下载完整安装包」。

## Decision

「更新到最新版」路径接入 `electron-updater`（pin `6.8.9`）做 blockmap 差量下载，原有全量下载 + SHA512SUMS 校验路径完整保留为回退：

1. **发布管线**：`build.publish` 从 `null` 改为 GitHub provider（只产元数据，不触发 `--publish`），electron-builder 随之产出 `resources/app-update.yml` 与 `dist/latest.yml`；`release.yml` artifact 与 `publish.yml` 资产/校验清单都收进 `latest.yml`（恰好一个，计入 SHA512SUMS）。
2. **新模块 `src/main/update-updater.js`**：`downloadLatestViaUpdater` 惰性加载 `electron-updater`，仅 Windows packaged 运行；无 manifest 版本返回 `no-update-in-manifest`；下载进度沿用既有载荷并带 `differential` 标记（真值以下载器报告行为准，无报告则按全量标记）。十五分钟预算显式把 `CancellationToken` 传给 `downloadUpdate(token)`；下载失败返回 `{ok:false, reason}` 回退。成功返回安装器路径，由 `update.js` 检查目标版本和发布清单 SHA512 后，在任务保护 commit 内观察 spawn，沿用 `--updated /S --force-run` 静默参数；启动失败报错并释放锁，不回退再次安装。见 [项目审查修复](../bug-fix/2026-09-30-project-audit-fixes.md)。
3. **分流缝 `installFromAsset`**：`installUpdate`（latest）以 `preferUpdater` 先试 updater 通道，非 packaged / 非 Windows / updater 失败一律落到既有 `downloadFile` + sha512 校验路径，确认与校验语义不变；`installRelease`（指定 tag）不传该标记——electron-updater 只认 `latest.yml` 指向的版本，指定版本永远全量。
4. **差量 COPY 源**：NSIS 安装器安装时把自身拷入 `%LOCALAPPDATA%\<app>-updater\installer.exe`，差量下载以此文件为旧包分块源，不依赖已安装文件可读性；缓存缺失时 electron-updater 自动全量。
5. **安装器 UAC**：`installer.nsh` `customInit` 并入 per-machine 提升块（`UAC_RunElevated` 弹一次 UAC、校验返回码与 Inner 实例哈希），覆盖 Program Files 目标下非管理员账户的差量安装场景。
6. **启动器**：进度载荷 `differential` 为真时文案显示「增量下载 N%」，全量时维持「下载 N%」。

## Alternatives considered

- **自写 blockmap + HTTP Range 差量下载器** — rejected：等于重造 `GenericDifferentialDownloader`（块表解析、COPY/DOWNLOAD 计划、拼接、回退），几千行经过实战检验的代码换一个自写拷贝，风险与收益不成比例。
- **`nsis-web` 目标（7z 分片 Web 安装器）** — rejected：多一条 `*-0.3.x.7z` 资产通道与第二套下载器，且 web 安装器把完整性校验挪到安装期而非下载期，现有 fail-closed 校验链反而变弱。
- **app.asar 级增量（解压增量）** — rejected：NSIS 差量比的是安装包分块，asar 未变时已经大部分复用；直接改已安装文件方案需要处理运行中锁文件与完整性，复杂度高一档收益近似。
- **历史版本切换也走 updater** — rejected：electron-updater 语义上只能装 `latest.yml` 指向的版本；为任意 tag 伪造 manifest 等于自建 feed 管道，`installRelease` 保持全量下载更简单也更诚实。
- **首次启用即要求差量** — rejected：旧版本（v0.3.2 之前）没有自拷贝缓存，首跳天然是全量；把「有缓存才更新」写成硬条件会让升级链路更脆。NSIS 自拷贝使 v0.3.2→v0.3.3 起即可差量，无需额外引导。

## Consequences

- 增量节省幅度随发布改动面浮动：只动业务代码时 Setup 分块大头（Electron 运行时、vendored harness）可复用，下载量可从 636 MB 降到几十 MB；换 Electron 大版本时接近全量。任何环节失败都不会比现状更差——最差即回退全量。
- 磁盘代价：`%LOCALAPPDATA%\deepseek-harness-desktop-updater\` 长期保留一份旧安装器（约 640 MB）作为差量源。
- 完整性契约不变：`latest.yml` 内嵌 sha512 与 `SHA512SUMS.txt` 同链校验；回退路径的校验/确认语义逐字保留。无代码签名：electron-updater 对未签名包警告并跳过签名校验（fail-open，与现状等价）；electron-builder v28 起改为 fail-closed，升级该工具链时需一并处理签名。
- 发布资产契约扩为三件套：Setup + `.blockmap` + `latest.yml`（`publish.yml` 硬校验恰好各一）。旧 v0.3.2 候选（run 35212201134）无 `latest.yml`，不满足新契约，发布前须在新 SHA 上重建候选。
- feature 卡 `desktop-launcher` 不变量新增差量通道条款；`.omc/RELEASE_RULE.md` 资产清单同步。
