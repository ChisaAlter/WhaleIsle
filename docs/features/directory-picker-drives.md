# Feature: 目录选择器跨盘浏览（Win32 卷选择层）

| Field | Value |
| --- | --- |
| **id** | `directory-picker-drives` |
| **status** | `active` |
| **last verified** | 2026-09-15 |

历史验证与变更记录见 [docs/history/directory-picker-drives.md](../history/directory-picker-drives.md)。

## User paths

1. 会话 Hero / 侧栏工作区 → 添加工作区 → 「选择工作区目录」对话框。
2. Windows 上面包屑最左侧是「此电脑」卷选择层：点击进入可见全部可进入盘符（`C:`、`D:`…），选中盘符根目录后右栏列出其子目录。
3. 卷选择层本身不可作为工作区：未选中盘符时「打开」「新建文件夹」禁用；`createDirectory` 对哨兵路径始终 `directory-create-failed`。
4. 移动端工作区目录浏览（`host.listDirectory` → `directoryPicker/list`）同样能看到「上层目录」链到卷选择层。

## Invariants

- 哨兵路径 `\\.\dsh-computer`（seam 导出 `WINDOWS_VOLUME_ROOT`；客户端常量重复于 `DirectoryBrowser.tsx`，两侧必须一致）。POSIX 上该路径不是完全限定路径，`list` 拒绝、`createDirectory` 失败关闭。
- Win32 下每个 `list` 结果的 `crumbs` 以卷选择器 crumb 开头（包括 UNC 链）；卷选择层自身 `crumbs` 只有哨兵一项。
- 盘符条目形如 `{ name: 'C:', path: 'C:\\' }`；逐盘符 `stat` 与 300ms 探测窗赛跑，空/阻塞/非目录盘符省略，不枚举网上邻居（UNC 仍可在路径编辑框直输）。
- 桌面 fork：客户端一半（`browser.computer` 文案、卷层禁用 Open）已在 vendor 内；host 一半是 `directory-picker-browse` 的桌面增量，sync 冲突由 `harness-desktop-forks.js` marker 兜底。

## Allowed touch

- `vendor/deepseek-harness/packages/host/directory-picker/src/index.ts`（`WINDOWS_VOLUME_ROOT`）、`src/types.ts`（crumbs 文档）
- `vendor/deepseek-harness/packages/host/directory-picker-browse/`（list/createDirectory/探测实现、spec、README）
- `src/shared/harness-desktop-forks.js` marker

## Do not touch

- POSIX 列举行为与 `fullyQualified` 栅栏语义
- 客户端 `DirectoryBrowser.tsx` 的卷层交互（已就位，除非上游改组件契约）
- `directoryPicker` Remote controller 的 wire 形状

## Gates

| Kind | What |
| --- | --- |
| Automated | `pnpm vitest run packages/host/directory-picker-browse`（vendor 内）；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 打开「选择工作区目录」→ 面包屑点「此电脑」→ 看到全部盘符并可进入非 C 盘 |

## Sources

- Decision: none

- Design: `vendor/deepseek-harness/.agents/notes/archived/architecture/2026-07-28-directory-picker-capability-seam.md`（Win32 卷枚举 = A–Z `stat` 赛跑 300ms）
- Implementation entry: `vendor/deepseek-harness/packages/host/directory-picker-browse/src/index.ts`（`volumeListing`/`probeDrive`）
