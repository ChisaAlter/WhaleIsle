# Decision: 打包运行时 Node 自包含化与拍平拷贝按目标路径去重

Status: implemented

中文 | [English](2026-09-22-packaged-node-self-contained.en.md)

## Problem

macOS 0.3.2 候选包实测两处发布级缺陷。其一：`copyBundledNode` 直接拷贝 `process.execPath`——Homebrew 安装的 node 是约 50KB 的瘦二进制，运行时依赖 `libnode.137.dylib` 与十余个 `/opt/homebrew/opt/*` 库，装到没有 Homebrew 前缀库的机器上 dsh 子进程直接 SIGABRT，桌面端起不来。其二：`collectFiles` 拍平模式把多个真实目录映射到同一个顶层 `node_modules/<pkg>`，去重表只按真实目录键控，不同的 src 可以在拷贝清单里共用同一 dest；`copyFiles` 以 32 路并发 `fs.copyFile` 写同一文件互相截断，留下「合法 JSON + 尾部碎片」的损坏 manifest，`dsh web` 启动即退出。

## Decision

修复全部落在 `scripts/after-pack.js`：新增 `pickCopyWinners`，在 `copyFiles` 入口按解析后的 dest 取唯一胜者——`.pnpm` store 路径输给顶层 hoisted 副本（与 pnpm 选定的顶层版本一致），同为非 store 路径则先来者赢；拍平收集、版本隔离修复、deploy 组装三条调用链统一受保护。`assertHarnessRuntime` 末尾追加 `assertNodeModulesManifests`：解析 `harnessDest/node_modules` 下全部 package.json，任何损坏 manifest 让打包期 fail-fast。`copyBundledNode` 在 darwin/linux 上先用 `otool -L` / `ldd` 探测 `process.execPath` 的动态库清单，命中 libnode、`homebrew`、`/opt/`、`/usr/local/` 前缀依赖即判定为瘦二进制，改为从 nodejs.org 下载官方独立构建（版本取根 `.nvmrc` 钉版，`DSH_NODE_DIST_MIRROR` 可换镜像），缓存于 `node_modules/.cache/dshd-node-dist/`，只抽取 `bin/node` 并以 `--version` 回读自检。win32 路径与 `NODE_BINARY` 覆盖行为不变。

## Alternatives considered

- **把 Homebrew 依赖库一并拷入包内并以 install_name_tool 重写 rpath** — rejected：依赖闭包随 Homebrew 配方版本漂移，要递归搬运并改写每一条加载路径；官方独立构建自包含、版本与 `.nvmrc` 钉版对齐，复杂度低一个量级。
- **在 collectFiles 收集期按 dest 去重** — rejected：收集器只产待拷清单，截断发生在写盘期的并发窗口；在 copyFiles 收口覆盖所有调用点（拍平、版本隔离、deploy 组装），一处生效且无遗漏。
- **manifest 门禁只抽查已知 CLI 关键依赖** — rejected：损坏面不可预知（本次同时命中 4 个包），全量解析 package.json 是数千个小文件的线性成本，覆盖更完整且规则更简单。

## Consequences

macOS/Linux 打包机不再依赖「恰好装了自包含 Node」的环境假设——瘦二进制环境自动改走官方构建，代价是首次打包多一次约 40MB 下载（缓存跨构建复用）。拍平后顶层内容与 pnpm hoisted 解析结果一致；manifest 门禁把同类损坏从「用户机上运行时崩溃」提前为「打包期失败」。`NODE_BINARY` 仍是显式覆盖出口，`DSH_NODE_DIST_MIRROR` 提供镜像逃生门。`scripts/after-pack.js` 目前不属于任何 feature 卡的 allowed touch（windows-installer 卡将其列为 Do not touch），本篇记录是这次改动的治理载体。
