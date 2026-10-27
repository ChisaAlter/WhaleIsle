<div align="center">

# dsh-usage-panel

Token usage statistics for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), shown as a page under **Settings → Usage** in the web GUI. The plugin aggregates persisted session logs (incrementally, via the session-projection mechanism) and never writes anything back.

[简体中文](README.zh-CN.md) · [![npm](https://img.shields.io/npm/v/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![npm downloads](https://img.shields.io/npm/dm/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![CI](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml) [![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin) [![Mentioned in Awesome DeepSeek Harness](https://awesome.re/mentioned-badge.svg)](https://github.com/0xsline/awesome-deepseek-harness)

<img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/demo.gif" width="620" alt="dsh-usage-panel v0.2 demo: loading, KPI count-up, heatmap entrance wipe, hover tooltips and range switching" />

</div>

## What it shows

- **Cumulative totals (all time)** — uncached input **+** output tokens (the same headline the local Magpie gateway reports; cache read/write are separate stats, shown on the detail line), session count (with the grand total of session records and the main/subagent usage split beneath it), and the most-used model with its share.
- **Cache hit rate** — `cache read ÷ (uncached input + cache read + cache write)`, with the read/write magnitudes.
- **Estimated cost (all time)** — a per-model priced estimate with a peak/off-peak split; see [Costs and pricing](#costs-and-pricing).
- **Activity heatmap** — one UTC calendar month at a time (GitHub-contribution layout: weeks as columns, weekdays as rows), with ‹ › to pick any month inside the last-six-months data window. Days are colored by quartile over that month's non-zero usage.
- **Daily stacked bars** — per-model token usage, switchable between the last 7, 14, or 30 days.
- **Top sessions** — the 10 most token-hungry sessions with their folded titles, each tagged **main** or **subagent** by delegation depth and carrying an estimated cost column.
- **Providers** — per-provider token totals as horizontal bars (shown when more than one provider route is in use).
- **Model donut** — all-time share per model, with the top 5 listed beside it; each row carries a per-model **cache hit rate** column, color-coded to its segment.
- **Export** — full JSON, daily CSV and per-model CSV (formula-injection guarded, RFC 4180, UTF-8 BOM; cost columns in integer cents).
- **Billing settings** — a modal next to Export: per-model custom prices (model list synced from the host provider directory + usage). It is the **only price editor** in the app; the harness's own price panel is gone. Prices are persisted in the harness conversation settings section, not in a record of this plugin's own — see [Costs and pricing](#costs-and-pricing).

The per-session peak/valley status and cost row under the chat input box is **not** part of this plugin: the desktop harness's `ui-conversation` `PeakValleyRow` owns it (Interface Settings → "Session cost"). This plugin registers no `conversation.composer.dock` entry, so the same line is never painted twice.

Hovering a bar, heatmap cell, or donut segment shows the exact breakdown:

| Bar tooltip | Overview (KPI + heatmap) | Sessions & providers |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-hover-bar.png" width="200" alt="Bar hover tooltip" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-overview.png" width="200" alt="KPI cards and heatmap overview" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-sessions.png" width="200" alt="Session ranking and provider breakdown" /> |

## Install

The plugin ships as a bundle: `dsh plugin add` appends it to the profile's bundle list, and the patch row activates the host half.

```sh
# from npm (recommended)
dsh plugin --profile web add dsh-usage-panel

# or from GitHub
dsh plugin --profile web add github:AlfredChaos/dsh-usage-panel

# or from a local checkout
dsh plugin --profile web add ./dsh-usage-panel
```

Restart `dsh --profile web` and open **Settings → Usage**. The npm package ships prebuilt JavaScript under `lib/` with no install scripts; GitHub installs need no pnpm build allowance either, because the same files are committed to the repository. To remove it:

```sh
dsh plugin --profile web remove dsh-usage-panel
```

## Where the numbers come from

The host half aggregates persisted session logs:

- **Primary path (incremental)**: a session projection (registered through `ctx.sessionProjections`, `stateVersion`-checked) folds every committed event into four disjoint buckets — uncached input, output, cache read, cache write — plus per-model, per-provider and per-day (UTC) maps. Scans consume the host's exact Session observations and release each lease after reading its projections. They share the host's prepared reads instead of cloning the complete log and replaying it a second time; a first cold read still decodes and validates the stored history.
- **Fallback path (full rescan)**: when the projection services are unavailable, the same reducer replays every session log through the read-only `sessionQuery` service.

Accounting rules: `request/header` and `request/context` events record the model (context base, header override); the step's `assistant/message` usage replaces streamed provisional usage (a retried same-step message never double-counts); `llm/retry` events are counted as retries, not tokens; `compaction/summary` usage is attributed to its own model and reported separately (and never enters the cost buckets); reasoning tokens are already inside output and are never added again.

**Token total definition**: every `total` in the payload — KPIs, heatmap/bars, session and project ranking, model donut, CSV exports — is **uncached input + output**. Cache read and cache write keep their own buckets and are displayed separately (the KPI detail line, the hit-rate card, the `cacheRead`/`cacheWrite` CSV columns); they are never added into a total. Hit rate stays `cache read ÷ (uncached input + cache read + cache write)`.

**Optional Magpie source**: when the local Magpie gateway keeps its usage ledger (`$MAGPIE_USAGE_FILE`, else `~/.config/magpie/usage.jsonl`), the host folds its `agent: "dsh"` rows — the ones `magpie usage` shows as "DeepSeek Harness" — and takes the all-time and recent totals, the day buckets, and the model/provider splits from it. That ledger survives session-log rotation, so the page matches `magpie usage` instead of under-reporting history its logs no longer contain. Models are keyed by the gateway's requested route (`req`, e.g. `codex/gpt-6.1-sol`), which is exactly the model id DSH writes into its session logs; the served id (`gpt-6.1-sol`) would match no cost row. A model's provider still comes from the logs (`magpie`) — the route the saved prices are scoped to — with the gateway's upstream id (`codex`, `factory`, …) used only for history the logs never saw. Provider rows regroup those same model buckets, so they add up to the all-time total. Sessions, projects, the per-session ranking and the cost buckets always stay log-derived: a gateway row carries no session identity and no billing phase. The page names the source under the header (folded call count + covered UTC range, hover for the file path); when the file is missing or unusable it falls back to the deduped log numbers. Traffic that never passes the gateway (a provider route configured directly) is outside these totals while the ledger is the source — that is what "matching `magpie usage`" means, and deleting/renaming the ledger file switches the page back to the log numbers.

**Fork dedup**: the host's `inheritedEventCount` excludes the exact inherited prefix, so forks do not double-bill their parents. Later restore-time `session/end-seed` markers cannot hide owned usage. Legacy callers without this metadata retain marker-based boundaries.

**Timezone declaration**: day buckets and exports use **UTC** calendar days (`YYYY-MM-DD`); the heatmap subtitle declares the selected month and UTC (e.g. "Aug 2026 · UTC"). Billing phases use **Beijing wall time** (UTC+8, DST-free) — see [Costs and pricing](#costs-and-pricing). `magpie usage` buckets its own per-day figures by **local** day, so one day cell can differ by the timezone offset while the all-time figures are identical.

Because nothing is written back, statistics survive restarts and cover sessions from before the plugin was installed.

## Costs and pricing

All money figures are **estimates, never a bill** — the plugin has no access to the DeepSeek billing system, and the numbers are computed locally from your usage.

- **Periods (official)**: peak = Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing; every other instant (weekends, evenings, nights, the noon break) is off-peak at the official idle rate. Off-peak prices are published as half of the peak rate.
- **Official price table**: data file with `asOf 2026-08-17` and the source link (DeepSeek API docs), pinned by unit tests. Models: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`; hit / miss / output × peak / off-peak. It is the fallback every unpriced official model bills at; the 计费设置 modal no longer renders a copy of it (pick a model to see its column in the price inputs).
- **Per-step classification**: a whole request (step) bills at its `step/start` instant — a step straddling a phase boundary is charged entirely at its start phase. Compaction never enters cost buckets.
- **Pricing**: per-model, applied client-side from the period buckets — changing a price recomputes every figure instantly and never refolds logs. Resolver order: your custom price (provider-scoped key first, bare-model legacy fallback) → the official column → **not priced**. An unpriced model shows "set a price" / an em dash, never a guessed figure; non-DeepSeek models need a custom price before any cost appears.
- **Custom prices**: edited in the usage panel's 计费设置 modal (per model: cache-hit, cache-miss, output; optional explicit off-peak column; per-model 峰谷计价 off for a single price). Turning that switch OFF saves the one price into **both** columns: the harness record has no flat field, it reads the three top-level numbers as the peak column and halves them when no off-peak column is present, so a flat record carrying peaks only was billed at half outside peak hours. Persisted in the **harness conversation settings section** — `ui-conversation.sessionCostPrices` — which is also the record the composer cost strip reprices from, so a price edited here shows up there immediately. Never written into session logs.
- **Legacy record (import only)**: versions up to v0.3 kept prices in this plugin's own storage domain (`dsh_usage_panel_billing`). On first start that record is merged **once** into the settings section — the section wins on key conflicts — and then cleared; the plugin never writes the domain again. The import is retried on later reads until both the section and the domain exist.
- **Peak/valley switch**: per model, and it opens in the state the model's saved record asks for — a saved 峰谷计价-off entry reopens off with its own price in the single row (labelled 价格, not 空闲价格), a saved two-column entry reopens on with both rows, a legacy peak-only entry reopens on with the off-peak row prefilled as half the peaks (exactly what the harness derives for it), and an unpriced model with an official column reopens on with that published pair. Only an unpriced model with no official column opens off and empty. The model dropdown has no placeholder: it opens on the first model of the selected provider. The global switch is gone (the conversation section has no such field): peak/valley pricing itself is always on, which is what the composer cost strip and the KPI both assume.
- **Math**: integer micro-yuan with a single rounding to whole cents; cost columns in CSV exports are integer cents (empty when a row is unpriced).

**Projection upgrades**: a changed projection version discards incompatible derived rows. The next statistics request reads exact logs and refolds the affected projections. Cold reads still decode and validate history; large logs can delay the Host despite the between-session pacing.

**Upgrade note (price record)**: prices now live in the harness conversation settings section, which the composer cost strip reprices from. Prices you saved in this plugin's earlier versions are merged into it once (the section wins on conflicts) and the old record is cleared — nothing to re-enter. A model you saved with 峰谷计价 off before this version is repaired once as well: its single price is written into the off-peak column too, so it stops being billed at half outside peak hours.

## Loading behavior

The first scan starts when the statistics page requests data. App startup, idle time and hidden settings-search renders do not scan the conversation corpus. Concurrent overview and ranking requests share the same scan; completed data is reused for 10 minutes. An older result or the refresh button waits for a fresh exact scan, so totals, rankings and repair candidates belong to the same completed read. The browser keeps its last successful payload in `localStorage` (versioned and structure-validated) and displays it while loading; a failed refresh keeps the cached numbers and says so instead of faking freshness. Search renders the page's headings and preference rows without loading statistics. After 60 seconds the client reports a timeout and allows retry; if the same request later succeeds, the still-mounted page accepts its exact result. A newer load or disposal excludes old results.

## Units

zh interface: integers below 10⁵; `万` from 10⁵; `亿` from 10⁸. en interface: K / M / B.

## Implementation

Source is TypeScript (strict) in `src/`, built with esbuild; the `lib/` outputs are committed so installs need no build step.

| File | Role |
| --- | --- |
| `src/host/index.ts` → `lib/index.js` | Host half (Cordis plugin): projection registration, aggregation, demand-scanned cached RPC, fail-soft fallback, billing RPC endpoints |
| `src/host/projection.ts` | Pure per-session projection reducer (four buckets + period buckets, fork dedup, retry/compaction semantics, UTC days, step/start phase) |
| `src/host/aggregate.ts` | Cross-session merge → overview payload (cost maps included) |
| `src/host/magpie-usage.ts` | Optional Magpie gateway ledger source: path resolution (`MAGPIE_USAGE_FILE` → `~/.config/magpie/usage.jsonl`), `agent === 'dsh'` fold (totals/byModel/byProvider/byDay), mtime+size cache, clean null fallback |
| `src/host/prices-source.ts` | The price record: reads `ui-conversation.sessionCostPrices` through the settings service, keeps the snapshot fresh from `settings/updated`, writes edits back |
| `src/host/legacy-billing-import.ts` | Pure merge of the retired `dsh_usage_panel_billing` record into that section + the gated one-time import |
| `src/host/billing-store.ts` | Retired plugin-owned price record: legacy reader (+ the import's cleanup write) |
| `src/host/types.ts` | Host-side structural faces for services without public host type packages (`connection`, `llm`, `settings`) |
| `src/client/*` → `lib/client.js` | Client half (`./client` export, `__ModuleLoader__` bundle): settings-page UI and settings modal in TSX, `--dsw-*` tokens, zh/en i18n |
| `src/shared/contract.ts` | Host↔client wire contract (single source of truth) |
| `src/shared/pricing.ts` | Official price table (asOf + source), resolver, price parsing |
| `src/shared/billing.ts` | Peak/valley window math + countdown |
| `src/shared/cost.ts` | Integer cost math (micro-yuan → cents) |
| `cordis.patch.yml` | Bundle patch: inserts the `usage-stats` row into the profile composition |

The host serves an `overview` endpoint through `ctx.connection.rpc.handle('/usage-stats', …, { authority: 'loopback' })`; the browser calls it via `rpc.call('/usage-stats', 'overview', …)`. The overview carries `coverage` (session-record totals, the main/subagent usage split, plus `source`/`magpie` provenance for the token totals), `topSessions`, `providers`, plus the v0.1.0-shaped `days` / `totals` / `byModel` / `allTime`. Developed against DeepSeek Harness `0.1.0-rc.6`. Tests run on the Node built-in test runner (`npm test`); CI runs typecheck + build + test + the pack gate.

## License

[MIT](LICENSE)
