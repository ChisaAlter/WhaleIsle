# TC-EXT-007 · dshbot 安装冒烟 — Windows 安装包仍 BLOCKED；Linux 源码级三相轮换 PASS（不填汇总表 Pass）

> 执行手册：[tc-ext-007-dshbot-install-smoke.md](../../tc-ext-007-dshbot-install-smoke.md)。
> 本次在云端 Linux 实机把手册 A/B(自动)/C 三相在**源码级 GUI** 上完整轮换了一遍
> （真实 Electron 窗口 + 真实 `dsh plugin add/remove` + walk 探针翻转 + 残留抽查）。
> **Windows NSIS 安装包三相仍未执行**，汇总表 TC-EXT-007 行维持「待测」，
> 不得据此填 Pass。

## 环境

| 项 | 值 |
| --- | --- |
| 执行日期 | 2026-08-26 |
| 执行人 / 代理 | Cursor 云端代理（Linux 实机测试轮） |
| 主机 | 云端 Linux x64（kernel 6.12.94+），X11 display `:1`（真实 GUI，非 headless 伪装） |
| 仓库检出 | `main` @ `7972a34fa5fa7c3c7e358a42f86e633f3d01a607`（test.yml run 32934988015 绿） |
| Node / Electron | Node v22.21.1（满足 engines ^22.19.0）；Electron 43.4.0（源码启动，非安装包） |
| 安装规格 | `github:ChisaAlter/Deepseek-Harness-Desktop#path:/vendor/dshbot`（与市场第一方行一致），pnpm 解析钉到 tarball SHA `7972a34…`（=本检出 HEAD） |
| Setup 文件名 + SHA256 | ☐ **未用安装包**（见下方 BLOCKED 说明） |

## 单测（前置门禁）

- 9 个 dshbot 套件（preset / room-preset / market-row / runtime-resilience /
  publish-manifest / avatar / a2a-memory / catalog / group-chat）：
  **95/95 全过**（[tc-ext-007-dshbot-unit-tests.txt](tc-ext-007-dshbot-unit-tests.txt)）。
- 相关套件 `harness-controller` + `release-ui-walk` + `marketplace-catalog`：47/47 全过。
- 全仓 `npm test`：**1102 测试，1099 pass / 0 fail / 3 skipped**。

## 三相结果（Linux 源码级；对应手册 A/B/C）

| 相 | 内容 | 结果 | 证据 |
| --- | --- | --- | --- |
| A（等价） | 全新 profile 未装 dshbot：`npm run qa:source` 全绿；`plugin.dshbot.tabAbsent` PASS、`plugin.dshbot.page` PASS（not installed; tab absent）、`plugin.dshbot.market` PASS（not installed on this profile） | **PASS** | [phase-a smoke JSON](tc-ext-007-phase-a-uninstalled-smoke.json) · [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-26/tc-ext-007-phase-a-uninstalled-qa.png) |
| B（自动化部分） | 对同一 dsh-home 用市场同款规格 `dsh plugin --profile web add github:…#path:/vendor/dshbot` 安装（[安装日志](tc-ext-007-phase-b-install.txt)）；profile manifest `dependencies`+`bundles` 出现 dshbot；重启 QA walk 断言翻转：`plugin.dshbot.page` PASS（installed dshbot shows the Bots tab）、`plugin.dshbot.market` PASS（standalone dshbot listed on Installed）；`.agent-presets/dshbot-room/`（agent.cordis.yml + preset.yml）由插件首载自装 | **PASS** | [phase-b smoke JSON](tc-ext-007-phase-b-installed-smoke.json) · [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-26/tc-ext-007-phase-b-installed-qa.png) |
| B（手工建群冒烟） | 建 2 bot → 建群 → 成员轮转发言 | **BLOCKED**：环境无 `DEEPSEEK_API_KEY`，成员 turn 走不了 `llm/stream`，轮转发言无法真实验证；不伪造 | — |
| C（等价） | `dsh plugin --profile web remove dshbot`（[卸载日志](tc-ext-007-phase-c-remove.txt)）后重启：walk 回未装分支全绿（tab absent / not listed）；残留抽查三处全净：`.agent-presets/dshbot-room` 已被启动清理删除、profile `package.json`/`pnpm-lock.yaml` 无 dshbot、`desktop-plugins/` 无 dshbot 拷贝或软链 | **PASS** | [phase-c smoke JSON](tc-ext-007-phase-c-uninstalled-smoke.json) · [残留抽查](tc-ext-007-phase-c-residue-check.txt) · [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-26/tc-ext-007-phase-c-uninstalled-qa.png) |

三次 QA walk 均为 `qa.ok=true, failed=[]`、`pageErrors=0`、PTY `echoed:ok`。

## Windows NSIS 安装包三相 — BLOCKED（维持）

- 云端为 Linux 主机，无 wine；NSIS Setup.exe 与 Windows Electron GUI 无法在本机执行。
- CI artifact 本身**可下载**：`DeepSeek-Harness-windows-x64`（artifact id 9544858472，
  506,766,640 bytes，SHA `18d7a0dbc36fe656d103f8ff0bfe3c32b5883f66`，未过期）。
  注意：今日绿 run `7972a34`（32934988015）只含单测 + vendor-gui 任务、不出安装包；
  最近出包的是 2026-08-25 的 run 32795458928。
- 结论：拿到 Windows 实机/长驻 VM 后按手册一键执行即可关此项；A/C 两相探针
  已在本轮 Linux 源码级验证与安装通道（同规格、同 CLI、同 walk 探针）上预演通过，
  剩余真正未覆盖面 = NSIS 安装器本身 + Windows 打包运行时 + 手工建群冒烟。

## 回填

- 汇总表 TC-EXT-007 行：维持「待测」（仍待 CI SHA + 已装 exe），备注补 2026-08-26
  Linux 源码级轮换结果链接。
- `docs/features/dshbot.md`：last verified 与 Open follow-ups P0 行更新（Windows
  实机仍为唯一缺口）。
