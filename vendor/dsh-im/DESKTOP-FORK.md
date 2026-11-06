# Desktop fork of `@xmanrui/dsh-im`

Pinned npm release: **3.0.1** (MIT). Hosted under `vendor/dsh-im` and loaded as a **first-party desktop module** by `src/main/dsh-im-desktop.js` (managed cordis package-name insert + profile `node_modules` junction to vendor). Not a soft `desktop-plugins` copy.

## Desktop-only patch

Registration retarget (replay on every pin bump):

- Upstream registers `settings.section` id `xmanrui-dsh-im` (label「IM机器人」).
- Desktop registers `settings.remote.tab` id `channels` (order 10, label「消息渠道」/ `Channels`) so the UI lives under Settings → Remote.

### Desktop UI strip (replay on every pin bump)

Channels is an embedded Settings tab, not a plugin-store page:

- Remove the `header.dim-title` block (DSH-IM brand, slogan, version tip, GitHub link).
- Root `section` / rail `aria-label` →「消息渠道」/ product Channels wording (not「IM机器人设置」).
- Delete brand/GitHub CSS (`.dim-title`, `.dim-brand*`, `.dim-github*`, `.dim-versionTooltip*`) and private `.dim-rail::-webkit-scrollbar*` rules.
- **Design-language shell:** primary CTAs use capsule geometry + `--dsw-alias-button-primary-fill` / `hover` (not Ant `#1677ff` or channel brand greens as button fill). Secondary = outline capsule + `--dsw-alias-border-l2` / interactive hover. Rail selected = sidebar-nav active (no card shadows). Brand hex only on rail/logo identity marks. Replay on `plugin-src/client/styles.js` and `plugin-src/client/channels/*/styles.js`.
- Rebuild with `npm run build` (or `node plugin-src/client/build.mjs`) so `lib/client.js` matches source.

Touched files:

- `lib/client.js` (published client bundle)
- `plugin-src/client/index.js` (source mirror for rebuilds)
- `plugin-src/client/styles.js`
- `plugin-src/client/channels/*/styles.js`

Host / RPC / credentials paths are unchanged except for the rc.1 host-context
bridge: channel starts receive the caller-scoped `webServer` service through
`ctx.extend({ webServer })`. Replay this patch in
`plugin-src/host/index.mjs` on every pin bump, and keep
`host-plugin.test.mjs` green to prove every channel receives the same scoped
server.

## Shared whale routing and background tasks

The nine chat channels use the resident whale default. Persisted binding metadata distinguishes manual bindings from `whale-auto/auto` plus the originating preset. Verified manual non-whale bindings and explicit non-whale presets do not read whale/desktop settings; malformed settings still fail visibly on whale/default routes. Manual non-whale bindings survive policy changes; obsolete automatic bindings stop applying when whale/IM is disabled or a different preset is selected. Unclassified legacy whale bindings require an explicit `/new` or `/session` when shared routing is off, while history is preserved. AI Office retains its separate Job Sessions.

The first background task adapter is Feishu: `plugin-src/host/channels/feishu/whale-tasks.mjs`. It accepts explicit `/task` from a desktop-authorized individual, reads attached or same-author quoted files in the original chat, and records stable ingress identity in `whaleTasks`. It does not create a second task state machine. The runtime registers a destination-bound sender that rechecks bot/account incarnation, task owner, access, switches and preset after asynchronous validation and immediately before SDK dispatch, using the task service's revision/hold admission. All management actions require current original-route authorization; status uses this guarded sender, and a denied command cannot fall through to an ordinary model read. Already admitted provider requests remain in flight and their receipts are retained. The task outbox owns retries/unknown; no recent-sender fallback or file delivery is used. Rebuild `lib/index.js` after these source edits. Usage and validation boundaries live in `vendor/dsh-whale/README.md`.

## Load contract

1. `scripts/setup-harness.js` / `after-pack.js` must `installPluginRuntimeDeps` then `assertVendoredPluginRuntimeDeps` for `dsh-im` (fail closed).
2. Startup calls `ensureDesktopDshIm` even under `skipUserPlugins`; `ok: false` blocks Harness start.
3. Cordis insert uses package name `@xmanrui/dsh-im` with a junction from profile `node_modules` → `vendor/dsh-im` (Loader rejects directory `file://`).
4. Marketplace installs of `@xmanrui/dsh-im` are `DROPPED`.

## Upgrade

1. `npm pack @xmanrui/dsh-im@<ver>` and replace `vendor/dsh-im` (keep `node_modules` via `npm install --omit=dev --omit=peer --ignore-scripts`).
2. Re-apply the registration retarget **and** Desktop UI strip above; rebuild `lib/client.js`.
3. Refresh this pin version line.
4. Confirm `missingRuntimeFiles(vendor/dsh-im)` is empty.
