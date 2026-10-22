# Feature: Desktop Pet

| Field | Value |
| --- | --- |
| **id** | `desktop-pet` |
| **status** | `active` |
| **last verified** | 2026-09-18 — fallback 图换鲸鱼娘徽标：`pet.html` 的 `pet__image` 由 `assets/whale.svg` 改 `assets/pet-head.png`（白底圆角方块 + 全身立绘，`pet.css` 加 `object-fit:cover`+`border-radius:50%` 贴进圆形按钮）；`whale.svg` 无引用已删。旧记录：2026-09-13 — `DESKTOP_PET_FEATURE=false`；Codex 皮肤发现、动画渲染与右键换肤已实现但默认隐藏 |

## User paths

1. Harness ready 后默认看到一个小型桌面宠物；点击它会播放一次挥手动画。
2. 拖拽宠物改变位置（播放行走动画）；窗口缩放、最大化或恢复后宠物仍在安全区域。
3. 托盘「桌面宠物」checkbox 可关闭或重新开启；右键宠物弹出换肤/隐藏菜单。开启状态、选中的 Codex 宠物与归一化位置在重启后恢复。
4. 自动发现 `${CODEX_HOME:-$HOME/.codex}/pets/` 下的 Codex 宠物目录，选择后无需复制资产即可显示；90 秒无交互进入打盹（降透明度停帧），悬停或点击唤醒。

## Invariants

- 宠物只存在于 Desktop shell 的小矩形 BrowserView；仅 Harness ready/revealed 时显示，boot、启动器、关闭遮罩和 Harness teardown 期间不存在残影。
- `src/main/desktop-pet.js` 的 `DESKTOP_PET_FEATURE` 开关为 `false` 时不创建宠物 BrowserView、不输出托盘「桌面宠物」项；`configureDesktopPet`/`getDesktopPet` 返回 null，已保存的 `pet` 配置保留以便重开时恢复。
- 不修改 `vendor/deepseek-harness/**`、Harness DOM、插件装配或会话数据。
- 持久化只包含 `{ enabled, xRatio, yRatio, petId }`；NaN、越界或畸形值回退到安全默认，归一化位置在窗口变化后 clamp。
- Codex 宠物导入只接受安全的相对 `spritesheetPath`，并同时兼容 v1 `8x9 / 1536x1872` 与 Desktop v2 `8x11 / 1536x2288` 图集；非法 manifest、路径穿越和尺寸不匹配的包被忽略。
- 宠物视图不能覆盖整窗透明区域；宠物矩形外 Harness 仍可正常点击。
- pet preload 只提供初始状态、状态订阅、位置提交、右键菜单和主题订阅；其它 shell/workspace/Git/文件/远程/插件 API 不暴露。
- 颜色与动效复用 `--dsw-alias-*` / 共享 motion token；不使用 `--boot-*` 或独立色板。

## Allowed touch

- `docs/design-language.md`, `docs/handbook/modules/window-chrome.md`, `docs/qa/production-acceptance-test-cases.md` — 记录 shell overlay 契约与验收。
- `src/main/desktop-pet.js`, `src/main/desktop-pets.js`, `src/main/window.js`, `src/main/config.js`, `src/main/ipc-authorization.js`, `src/main/tray*.js`, `src/main/chrome.js`, `src/main/index.js` — 生命周期、Codex 皮肤发现、持久化、窄 IPC、托盘和主题装配。
- `src/preload/index.js`, `src/renderer/pet.*`, `assets/pet-head.png` — 最小 pet bridge、Codex 图集渲染与 fallback 资产（白底圆角方块 + 全身立绘，`pet__image` 圆形裁切）。
- 宠物管理器只读取 Codex pets 根目录并向 renderer 传递已校验的本地图集 URL，不向 renderer 暴露通用文件系统 API。
- 对应 focused tests。

## Do not touch

- `vendor/deepseek-harness/**`、Harness DOM 注入、插件/会话数据结构。
- 全窗口透明 BrowserView、宠物商店/喂养/等级/AI 对话/声音/多宠物。独立宠物窗形态归 [desktop-live2d-pet](desktop-live2d-pet.md) 卡，不在本卡演进。
- token 投喂/成长口径归 [desktop-live2d-pet](desktop-live2d-pet.md) 卡：token = 未缓存 input + output（缓存读写单列，不计口粮），优先聚合 `~/.config/magpie/usage.jsonl` 的 `agent==='dsh'` 行，`growth.accountingVersion: 2` 管迁移。本卡只描述停用的 Codex 立绘形态，不涉及 token 记账。

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/desktop-pet.test.js src/main/desktop-pets.test.js src/main/config.test.js src/main/tray.test.js src/preload/shell-api.test.js src/main/ipc-authorization.test.js`；`npm test`；`npm run smoke:source` |
| Manual / QA | `TC-DESK-010` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) |

## Sources

- Decision: none

- Design: [design-language.md](../design-language.md#桌面宠物)
- Plan: ChatGPT C2C task `c2c_4e7b`, iteration 0
- Implementation entry: `src/main/desktop-pet.js`、`src/main/desktop-pets.js` and `src/main/window.js`
