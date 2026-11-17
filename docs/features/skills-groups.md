# Feature: 技能分组多选（Skills groups）

| Field | Value |
| --- | --- |
| **id** | `skills-groups` |
| **status** | `active` |
| **last verified** | 2026-08-29 |

历史验证与变更记录见 [docs/history/skills-groups.md](../history/skills-groups.md)。

## User paths

1. 设置 → 技能 → 编辑/添加技能：「分组」字段为多选 tag picker——已选标签可逐个移除（×），下拉勾选已有分组，输入新分组回车（或逗号）添加，「清空分组」恢复未分组。
2. 技能目录：一个技能出现在它每一个分组的分区里；分组开关按分区批量切换模型调用。
3. 搜索命中名称/描述/何时使用/任意一个分组标签。

## Invariants

- 一个技能可属于多个分组；落盘为 SKILL.md frontmatter `metadata.group`（Settings 写 YAML 列表；读取同时接受标量或列表并归一化：trim、去空、去重、保序）；空列表/缺省 = 未分组。
- wire 字段为 `groups?: readonly string[]`（Entry/Detail/Create/Update），不再有单值 `group`；update 省略 `groups` 不改动已存标签，空数组清除。
- Settings 只拥有 `metadata.group` 这一个键：同级 metadata 字段、未知顶层字段、非对象 metadata 原样保留。
- 下拉列表 = 官方 `Menu`（`selectedIds` 打勾、portal、与输入框同宽）；多选切换后菜单保持打开；外点/Esc/再点触发按钮关闭。
- 编辑器弹窗内保存 pending 时整个 picker 禁用。
- 组开关为乐观回显：点击立即翻转该组全部可写行的状态（不等待 frontmatter 写盘），写失败的行回退到原值并显示行内错误；批量进行中开关仍禁用。
- 停用组不折叠分区（展开/收起只由分区头控制）。
- 会话作用域目录读取失败（如会话历史损坏导致 Agent 无法挂载、`session-not-found`）时，自动降级为全局技能目录并显示 `sessionCatalogUnavailable` 提示，不再整页报错；全局目录也失败才显示错误视图。
- 分区顺序 = 分组标签首现顺序，未分组区恒在最后；结果计数按技能条数（不因多分区重复计数）。
- fork 存在性由 `src/shared/harness-desktop-forks.js` 的 `FORK_FILE_MARKERS` 钉住（`SkillsSection.tsx` 仍含 `SettingsSelect`）。

## Allowed touch

- `vendor/deepseek-harness/packages/host/skill-inventory/`（types/gateway/frontmatter/README/测试）
- `vendor/deepseek-harness/packages/client/ui-settings-skills/`（SkillsSection、locales、CSS、client spec）
- `docs/features/skills-groups.md`

## Do not touch

- 来源筛选、来源 Pill、删除、打开目录、调用开关（行/组）语义
- 分组折叠/展开的 sessionStorage 键（`dshd.settings.skills.tree`）
- `dsh-skill` provider 的 metadata 透传契约与 composer `skill.list` RPC

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor：`pnpm --filter @deepseek-ai/dsh-host-skill-inventory… test`、`pnpm --filter @deepseek-ai/dsh-client-ui-settings-skills… test`。Desktop：`npm test`（fork 标记） |
| Manual / QA | 设置 → 技能：多选、回车新建、移除标签、清空；旧标量 `metadata.group` 文件读取为单标签并可正常保存 |

## Sources

- Decision: none

- Implementation: `vendor/deepseek-harness/packages/client/ui-settings-skills/src/client/SkillsSection.tsx`（GroupTagPicker）、`packages/host/skill-inventory/src/index.ts`（normalizeMetadataGroups）
- 邻接卡: [settings-select.md](settings-select.md)（来源筛选下拉）
