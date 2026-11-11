# dshbot · official CLI Bots UI fallback — 2026-08-29

Plan: [../../superpowers/plans/2026-08-29-dshbot-official-bots-ui-fallback.md](../../superpowers/plans/2026-08-29-dshbot-official-bots-ui-fallback.md).
Prior FAIL: [../2026-08-28/dshbot-official-cli.md](../2026-08-28/dshbot-official-cli.md) B5 (Bots tab absent).

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-08-29 |
| Official CLI | `@deepseek-ai/dsh@0.1.1-rc.2` |
| Node | v22.15.0 (`engines` requirement) |
| `$DSH_HOME` | `/tmp/dshbot-official-fallback-home` (isolated) |
| Install spec | `file:/workspace/vendor/dshbot` (branch `cursor/dshbot-official-bots-fallback-19cc`) |
| UI | `dsh web` → `http://127.0.0.1:3080` + Chrome CDP |

## Results

| Step | Result | Evidence |
| --- | --- | --- |
| Gate `dshbot-*.test.js` | **PASS** 104/104 | includes new `dshbot-official-ui-fallback` |
| Publish preflight | **PASS** | `check-dshbot-publish.mjs dshbot-v0.2.0` |
| Official install + list | **PASS** | [dshbot-fallback-install.log](dshbot-fallback-install.txt) |
| Preset self-install | **PASS** | `.agent-presets/dshbot-room/{preset.yml,agent.cordis.yml}` after web boot |
| Bots footer trigger visible | **PASS** (was B5 FAIL) | CDP: `data-dshbot-official-trigger` aria-label Bots; [sidebar png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-29/dshbot-official-fallback-sidebar.png) |
| Panel opens BotPage | **PASS** | empty state “No bots yet…”; [panel png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-29/dshbot-official-fallback-panel.png) |
| Desktop tab path | **PASS** (contract) | probe prefers region tabs when both specs exist; no dual footer when tabs present |

## Notes

- Official entry is a **footer.action** panel, not a region tab (documented Known limitation).
- Peer missing-peer warnings still appear under official `dsh plugin` (pnpm); install succeeds.
- Live group turns / Windows TC-EXT-007 still BLOCKED (no API key / no Windows).
