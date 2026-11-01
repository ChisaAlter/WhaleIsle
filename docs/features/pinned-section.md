# Feature: 侧栏「已置顶」区（跨工作区置顶）

| Field | Value |
| --- | --- |
| **id** | `pinned-section` |
| **status** | `active` |
| **last verified** | 2026-11-01 — 隔离实例 + 假模型：「工作区」与「无工作目录」各置顶一个会话，两行同时出现在侧栏最上面的「已置顶」区（最近置顶在前，行内淡色标出所属工作区），原分组里不再重复；折叠/展开该区、取消置顶（回到原分组）、归档置顶会话（离开该区）、重启后保留，都按预期。vendor ui-workspace 13 个文件 560 项通过（含新增 7 项），`tsc --noEmit` 过，`harness-desktop-forks` 含真实树通过。 |

## User paths

1. 在会话行点图钉，或「⋯ → 置顶会话」：会话出现在侧栏最上面的「已置顶」区。所有工作区（含「无工作目录」）的置顶会话集中在这里，最近置顶的在前；每行右侧用淡色显示所属工作区名，原分组里不再重复显示。
2. 取消置顶：会话回到原工作区分组，位置按该分组原来的排序。
3. 点「已置顶」标题折叠/展开；这个选择和分组的展开状态一起保存。
4. 工作区分组折叠时，它里面的置顶会话照样显示在「已置顶」区。
5. 「单列表」视图不变（置顶本来就在整个列表最前）；搜索结果不受影响。

## Invariants

- 置顶仍是 Host 的 registry 全局集合（`pinSession` / `unpinSession`，最近置顶在前，归档同时清掉置顶），这次只改侧栏呈现；Host、client service、`PinSession` 动作入口都不动。
- 之前的行为是「置顶只在所在分组内排最前」（上游设计）。多工作区时置顶会话在整个侧栏里并不靠前，用户反馈「置顶好像无效」，所以改成全局置顶区（用户 2026-11-01 选定「顶部加已置顶区，从原分组移出」）。
- 已置顶区的行 = 已列出（工作区成员或无工作目录）、未归档、非空白、非子智能体、非 navigationOwner 的置顶会话（`derivePinned`）；「仅显示已归档」视图不显示该区。
- `deriveGroups` 的 `hoistPinned` 选项把这些行从分组里去掉；默认 `false`，仍是「置顶行领先本组」（单测与上游语义保留）。`SessionTree` 总是传 `true`。
- 同一会话在 DOM 里只有一行（`data-row-key="session:<id>"` 唯一），所以置顶/取消置顶时 `AnimatedRows` 的位移动画自然生效。
- 已置顶区的行不可拖拽、不显示图钉标记（整个区就是「已置顶」，行内标记多余且占宽度）；顺序就是置顶顺序，想调整就取消后重新置顶。原先「置顶行在分组内拖动」的三个用例已换成置顶区用例；单列表的置顶拖拽不变。
- 展开键 `::pinned`（`PINNED_SECTION_KEY`）存在 `groupExpansion` 里，`retainAccountKeys` 的保留列表包含它，不会被清掉。搜索定位到一个置顶会话时，若该区被折叠会自动展开。
- 工作区名最宽 64px，超出省略；窄侧栏（约 250px）下标题会比分组里的行短，这是两列信息的代价。

## Allowed touch

- vendor `ui-workspace` 的 `tree.ts`（`derivePinned` / `hoistPinned` / `PINNED_SECTION_KEY`）、`rows/Rows.tsx`（`PinnedSectionHeader`、行内 `context`）、`rows/WorkspaceBrowser.tsx`、`rows/Rows.module.css`、`locales.ts`（`section.pinned`）及对应 client specs
- `src/shared/harness-desktop-forks.js` 与其测试（位置标记）

## Do not touch

- `workspace-controller` / `workspace` registry 的置顶命令与数据格式
- `FlatList`（单列表）的置顶排序与拖拽
- `PinSession` 的菜单项与悬停按钮（它们只调用 `pinSession` / `unpinSession`）

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-workspace/tests/tree.client.spec.ts`（`pinned section`：`derivePinned` 的顺序/标签/排除项，`hoistPinned` 与默认行为）与 `workspace-browser.client.spec.tsx`（置顶区居首、分组折叠时仍显示、不可拖拽、置顶/取消置顶在分组与置顶区之间移动、折叠状态与仅归档视图）；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 至少两个工作区：各置顶一个会话，确认它们都在侧栏最上面、标出所属工作区；折叠其中一个工作区后仍可见；取消置顶回到原分组；归档置顶会话后离开该区 |

## Sources

- 关联：[no-directory-sessions](no-directory-sessions.md)（「无工作目录」分组的标签与归属）
